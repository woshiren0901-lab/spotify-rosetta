import type {
  LyricsLine,
  ProviderCandidate,
  ProviderFetchOptions,
  ProviderId,
  ProviderResult,
  TrackInfo,
} from "../types";
import {
  asArray,
  asRecord,
  asString,
  readPath,
  requestJson,
} from "../core/http";
import {
  attachWordSegments,
  deriveTranslationSegments,
  parseLrc,
  parseWordTimedLyrics,
  pairTranslations,
  unsyncedTranslationText,
} from "../core/lrc";
import {
  buildProviderResult,
  dedupeProviderCandidates,
  searchTrackVariants,
} from "./common";
import { normalizeIsrc } from "../core/normalize";

const MIRROR_BASE = "https://music.xianqiao.wang/neteaseapiv2";
const GD_STUDIO_BASE = "https://music-api.gdstudio.xyz/api.php";

function mapSong(value: unknown): ProviderCandidate | undefined {
  const song = asRecord(value);
  const id = asString(song.id);
  const title = asString(song.name ?? song.title);
  if (!id || !title) return undefined;
  const artists = asArray(song.artists ?? song.ar)
    .map((artist) => asString(asRecord(artist).name))
    .filter(Boolean);
  const album = asString(
    readPath(song, ["album", "name"]) ?? readPath(song, ["al", "name"]),
  );
  return {
    providerId: "netease",
    sourceId: id,
    title,
    artists,
    album,
    durationMs: Number(song.duration ?? song.dt ?? 0) || 0,
    isrc: normalizeIsrc(
      asString(song.isrc ?? song.isrcCode ?? song.external_id),
    ),
    sourceUrl: `https://music.163.com/#/song?id=${encodeURIComponent(id)}`,
    sourceLabel: "网易云音乐",
  };
}

function mapGdStudioSong(value: unknown): ProviderCandidate | undefined {
  const song = asRecord(value);
  const id = asString(song.id ?? song.lyric_id);
  const title = asString(song.name);
  if (!id || !title) return undefined;
  return {
    providerId: "netease",
    sourceId: id,
    title,
    artists: asArray(song.artist)
      .map((artist) => asString(artist))
      .filter(Boolean),
    album: asString(song.album),
    durationMs: 0,
    sourceUrl: `https://music.163.com/#/song?id=${encodeURIComponent(id)}`,
    sourceLabel: "网易云音乐",
    extra: { gdstudio: "1", lyricId: asString(song.lyric_id) || id },
  };
}

async function searchViaGdStudio(
  track: TrackInfo,
  signal: AbortSignal,
): Promise<ProviderCandidate[]> {
  const params = new URLSearchParams({
    types: "search",
    source: "netease",
    name: `${track.title} ${track.artists.join(" ")}`.trim(),
    count: "20",
    pages: "1",
  });
  const response = await requestJson<unknown>(
    `${GD_STUDIO_BASE}?${params.toString()}`,
    { signal },
  );
  return asArray(response)
    .map(mapGdStudioSong)
    .filter((candidate): candidate is ProviderCandidate => Boolean(candidate));
}

async function searchViaMirror(
  track: TrackInfo,
  signal: AbortSignal,
): Promise<ProviderCandidate[]> {
  const query = encodeURIComponent(`${track.title} ${track.artists.join(" ")}`);
  const response = await requestJson<unknown>(
    `${MIRROR_BASE}/search?limit=10&type=1&keywords=${query}`,
    { signal },
  );
  const songs =
    readPath(response, ["result", "songs"]) ??
    readPath(response, ["songs"]) ??
    readPath(response, ["data", "songs"]);
  return asArray(songs)
    .map(mapSong)
    .filter((candidate): candidate is ProviderCandidate => Boolean(candidate));
}

async function searchViaPublicEndpoint(
  track: TrackInfo,
  signal: AbortSignal,
): Promise<ProviderCandidate[]> {
  const query = encodeURIComponent(`${track.title} ${track.artists.join(" ")}`);
  const response = await requestJson<unknown>(
    `https://music.163.com/api/search/get/web?csrf_token=&s=${query}&type=1&offset=0&total=true&limit=20`,
    {
      signal,
      headers: {
        Referer: "https://music.163.com/",
      },
    },
  );
  return asArray(readPath(response, ["result", "songs"]))
    .map(mapSong)
    .filter((candidate): candidate is ProviderCandidate => Boolean(candidate));
}

async function fetchLyrics(
  candidate: ProviderCandidate,
  signal: AbortSignal,
): Promise<unknown> {
  if (candidate.extra?.gdstudio === "1") {
    const params = new URLSearchParams({
      types: "lyric",
      source: "netease",
      id: candidate.extra.lyricId || candidate.sourceId,
    });
    const response = await requestJson<unknown>(
      `${GD_STUDIO_BASE}?${params.toString()}`,
      { signal },
    );
    if (!asString(readPath(response, ["lyric"])).trim()) {
      throw new Error("GD Studio 没有返回网易云原文。");
    }
    return response;
  }
  const attempts = [
    requestJson<unknown>(
      `${MIRROR_BASE}/lyric?id=${encodeURIComponent(candidate.sourceId)}`,
      { signal },
    ),
    requestJson<unknown>(
      `https://music.163.com/api/song/lyric?id=${encodeURIComponent(candidate.sourceId)}&lv=-1&kv=-1&tv=-1&rv=-1`,
      {
        signal,
        headers: {
          Referer: "https://music.163.com/",
        },
      },
    ),
  ].map(async (attempt) => {
    const response = await attempt;
    if (!asString(readPath(response, ["lrc", "lyric"])).trim()) {
      throw new Error("No synchronized lyrics in response.");
    }
    return response;
  });
  return Promise.any(attempts);
}

async function buildResult(
  candidate: ProviderCandidate,
  track: TrackInfo,
  signal: AbortSignal,
  options: ProviderFetchOptions = {},
): Promise<ProviderResult> {
  const response = asRecord(await fetchLyrics(candidate, signal));
  const originalText =
    asString(readPath(response, ["lrc", "lyric"])) ||
    asString(readPath(response, ["lyric"]));
  if (!originalText.trim()) {
    throw new Error("网易云没有返回可用的同步原文。");
  }

  const parsedOriginal = parseLrc(originalText);
  let lines: LyricsLine[] = parsedOriginal.lines;
  const translationValue = readPath(response, ["tlyric"]);
  const translationText =
    asString(readPath(response, ["tlyric", "lyric"])) ||
    (typeof translationValue === "string" ? translationValue : "");
  if (!translationText.trim() && !options.allowOriginalOnly) {
    throw new Error("网易云条目没有 tlyric 现成译文。");
  }
  let unsyncedTranslation: string | undefined;

  if (translationText.trim()) {
    if (/\[\d{1,3}:\d{2}/.test(translationText)) {
      const parsedTranslation = parseLrc(translationText);
      lines = pairTranslations(
        lines,
        parsedTranslation.lines.map((line) => ({
          startMs: line.startMs,
          text: line.original,
        })),
      );
    } else {
      unsyncedTranslation = unsyncedTranslationText(translationText);
    }
  }

  const wordText =
    asString(readPath(response, ["klyric", "lyric"])) ||
    asString(readPath(response, ["yrc", "lyric"]));
  if (wordText.trim()) {
    lines = attachWordSegments(lines, parseWordTimedLyrics(wordText));
  }
  lines = lines.map((line) => {
    const translationSegments = deriveTranslationSegments(
      line.translation,
      line.wordSegments,
    );
    return translationSegments ? { ...line, translationSegments } : line;
  });

  return buildProviderResult(
    "netease",
    track,
    candidate,
    lines,
    unsyncedTranslation,
  );
}

export class NeteaseProvider {
  readonly id: ProviderId = "netease";
  readonly label = "网易云音乐";
  readonly providesTranslations = true;

  async search(
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<ProviderCandidate[]> {
    const variants = searchTrackVariants(track);
    const gdStudio = await Promise.allSettled(
      variants.map((variant) => searchViaGdStudio(variant, signal)),
    );
    const gdStudioCandidates = dedupeProviderCandidates(
      gdStudio.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
    );
    if (gdStudioCandidates.length) return gdStudioCandidates;

    const mirror = await Promise.allSettled(
      variants.map((variant) => searchViaMirror(variant, signal)),
    );
    const mirrorCandidates = dedupeProviderCandidates(
      mirror.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
    );
    if (mirrorCandidates.length) return mirrorCandidates;

    const publicResults = await Promise.allSettled(
      variants.map((variant) => searchViaPublicEndpoint(variant, signal)),
    );
    return dedupeProviderCandidates(
      publicResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
    );
  }

  async fetch(
    candidate: ProviderCandidate,
    track: TrackInfo,
    signal: AbortSignal,
    options?: ProviderFetchOptions,
  ): Promise<ProviderResult> {
    return buildResult(candidate, track, signal, options);
  }
}

