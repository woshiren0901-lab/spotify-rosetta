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
  parseJsonObject,
  readPath,
  requestJson,
  requestText,
} from "../core/http";
import {
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
import { decryptQrc } from "./qrc";
import { normalizeIsrc } from "../core/normalize";

const SEARCH_URL = "https://u6.y.qq.com/cgi-bin/musicu.fcg";
const LEGACY_LYRIC_URL =
  "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg";
const NEW_LYRIC_URL =
  "https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg";

function mapSong(value: unknown): ProviderCandidate | undefined {
  const song = asRecord(value);
  const mid =
    asString(song.mid) ||
    asString(song.songmid) ||
    asString(song.songMid);
  const id = asString(song.id ?? song.songid ?? mid);
  if (!mid && !id) return undefined;
  const title = asString(song.name ?? song.title ?? song.songname);
  if (!title) return undefined;
  const artists = asArray(song.singer)
    .map((artist) => asString(asRecord(artist).name))
    .filter(Boolean);
  const album = asString(
    readPath(song, ["album", "name"]) ??
      readPath(song, ["albumname"]) ??
      song.albumname,
  );
  const interval = Number(song.interval ?? song.duration ?? 0);
  return {
    providerId: "qq",
    sourceId: mid || id,
    title,
    artists,
    album,
    durationMs: interval > 0 ? interval * 1_000 : 0,
    isrc: normalizeIsrc(
      asString(song.isrc ?? song.isrcCode ?? song.external_id),
    ),
    sourceUrl: `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(mid || id)}`,
    sourceLabel: "QQ音乐",
    extra: {
      songId: id,
      songMid: mid,
    },
  };
}

function collectSearchSongs(response: unknown): unknown[] {
  const paths: Array<Array<string | number>> = [
    ["req_1", "data", "body", "song", "list"],
    ["req_1", "data", "body", "item_song"],
    ["music.search.SearchCgiService", "data", "body", "song", "list"],
    ["music.search.SearchCgiService", "data", "body", "item_song"],
    ["music.search.SearchCgiService.DoSearchForQQMusicMobile", "data", "body", "song", "list"],
    ["music.search.SearchCgiService.DoSearchForQQMusicMobile", "data", "body", "item_song"],
  ];
  for (const path of paths) {
    const songs = asArray(readPath(response, path));
    if (songs.length) return songs;
  }
  return [];
}

async function searchDesktop(
  track: TrackInfo,
  signal: AbortSignal,
): Promise<ProviderCandidate[]> {
  const query = `${track.title} ${track.artists.join(" ")}`.trim();
  const response = await requestJson<unknown>(SEARCH_URL, {
    method: "POST",
    signal,
    body: {
      req_1: {
        method: "DoSearchForQQMusicDesktop",
        module: "music.search.SearchCgiService",
        param: {
          num_per_page: "20",
          page_num: "1",
          query,
          search_type: 0,
        },
      },
    },
    headers: {
      Referer: "https://y.qq.com/",
    },
  });
  return collectSearchSongs(response)
    .map(mapSong)
    .filter((candidate): candidate is ProviderCandidate => Boolean(candidate));
}

async function searchMobile(
  track: TrackInfo,
  signal: AbortSignal,
): Promise<ProviderCandidate[]> {
  const query = `${track.title} ${track.artists.join(" ")}`.trim();
  const key = "music.search.SearchCgiService.DoSearchForQQMusicMobile";
  const response = await requestJson<unknown>(SEARCH_URL, {
    method: "POST",
    signal,
    body: {
      comm: {
        ct: "11",
        v: "20080508",
        tmeLoginType: "0",
        tmeLoginMethod: "0",
      },
      [key]: {
        module: "music.search.SearchCgiService",
        method: "DoSearchForQQMusicMobile",
        param: {
          query,
          highlight: 1,
          searchid: "",
          sub_searchid: 0,
          search_type: 0,
          nqc_flag: 0,
          sin: 0,
          ein: 30,
          page_num: 1,
          num_per_page: 20,
          cat: 2,
          grp: 1,
          remoteplace: "",
          from: "",
          multi_zhida: 1,
          sem: 0,
          related_data: "",
          ambi_data: "",
        },
      },
    },
    headers: {
      Referer: "https://y.qq.com/",
    },
  });
  return collectSearchSongs(response)
    .map(mapSong)
    .filter((candidate): candidate is ProviderCandidate => Boolean(candidate));
}

async function decodeMaybeBase64(value: string): Promise<string> {
  const cleaned = value.trim();
  if (!cleaned) return "";
  if (/\[\d{1,3}:\d{2}|\[\d+,\d+\]/.test(cleaned) || cleaned.includes("\n")) {
    return cleaned;
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(cleaned)) return cleaned;

  try {
    const binary = atob(cleaned.replace(/\s+/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b && "DecompressionStream" in window) {
      const decompressed = await new Response(
        new Blob([bytes]).stream().pipeThrough(
          new DecompressionStream("gzip"),
        ),
      ).arrayBuffer();
      return new TextDecoder().decode(decompressed);
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return decoded || cleaned;
  } catch {
    return cleaned;
  }
}

function parseLegacyPayload(text: string): Record<string, unknown> {
  try {
    return asRecord(parseJsonObject(text));
  } catch {
    return {};
  }
}

async function fetchLegacyLyrics(
  candidate: ProviderCandidate,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const mid = candidate.extra?.songMid || candidate.sourceId;
  const params = new URLSearchParams({
    callback: "MusicJsonCallback_lrc",
    songmid: mid,
    g_tk: "5381",
    jsonpCallback: "MusicJsonCallback_lrc",
    loginUin: "0",
    hostUin: "0",
    format: "json",
    inCharset: "utf8",
    outCharset: "utf-8",
    notice: "0",
    platform: "yqq",
    needNewCode: "0",
  });
  const text = await requestText(`${LEGACY_LYRIC_URL}?${params.toString()}`, {
    signal,
    headers: {
      Referer: "https://y.qq.com/",
    },
  });
  return parseLegacyPayload(text);
}

async function fetchNewLyrics(
  candidate: ProviderCandidate,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const songId = candidate.extra?.songId || candidate.sourceId;
  const text = await requestText(NEW_LYRIC_URL, {
    method: "POST",
    signal,
    body: new URLSearchParams({
      version: "15",
      miniversion: "82",
      lrctype: "4",
      musicid: songId,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://y.qq.com/",
    },
  });
  return {
    xml: text.replace(/<!--/g, "").replace(/-->/g, ""),
  };
}

export function extractNewXmlValue(
  payload: Record<string, unknown>,
  key: string,
): string {
  const xml = asString(payload[key]) || asString(payload.xml);
  if (!xml) return "";
  const match = xml.match(new RegExp(`<${key}[^>]*>([\\s\\S]*?)</${key}>`, "i"));
  const value = match?.[1]?.trim() ?? xml.trim();
  return value
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

async function buildResult(
  candidate: ProviderCandidate,
  track: TrackInfo,
  signal: AbortSignal,
  options: ProviderFetchOptions = {},
): Promise<ProviderResult> {
  let payload: Record<string, unknown>;
  let detailedPayload: Record<string, unknown> | undefined;
  try {
    payload = await fetchLegacyLyrics(candidate, signal);
  } catch {
    payload = await fetchNewLyrics(candidate, signal);
    detailedPayload = payload;
  }

  let originalText =
    asString(payload.lyric) ||
    asString(payload.lrc) ||
    extractNewXmlValue(payload, "content") ||
    extractNewXmlValue(payload, "orig");
  let translationText =
    asString(payload.trans) ||
    asString(payload.ts) ||
    extractNewXmlValue(payload, "contentts") ||
    extractNewXmlValue(payload, "ts");

  if (!originalText || !translationText) {
    try {
      detailedPayload ??= await fetchNewLyrics(candidate, signal);
      if (!originalText) {
        originalText =
          extractNewXmlValue(detailedPayload, "content") ||
          extractNewXmlValue(detailedPayload, "orig");
      }
      if (!translationText) {
        translationText =
          extractNewXmlValue(detailedPayload, "contentts") ||
          extractNewXmlValue(detailedPayload, "ts");
      }
    } catch {
      // Legacy lyrics remain usable when the detailed endpoint is unavailable.
    }
  }

  originalText = await decodeMaybeBase64(originalText);
  translationText = await decodeMaybeBase64(translationText);
  if (!originalText.trim()) {
    throw new Error("QQ音乐没有返回可用的同步原文。");
  }
  if (!translationText.trim() && !options.allowOriginalOnly) {
    throw new Error("QQ音乐条目没有 ts 现成译文。");
  }

  let wordLines = parseWordTimedLyrics(originalText);
  if (detailedPayload) {
    const encryptedOriginal =
      extractNewXmlValue(detailedPayload, "content") ||
      extractNewXmlValue(detailedPayload, "orig");
    if (encryptedOriginal) {
      try {
        const decryptedQrc = await decryptQrc(encryptedOriginal);
        const qrcLines = parseWordTimedLyrics(decryptedQrc);
        if (qrcLines.some((line) => line.wordSegments?.length)) {
          wordLines = qrcLines;
        }
      } catch {
        // Line-level legacy lyrics remain valid if a QRC payload changes.
      }
    }
  }
  const parsedOriginal = parseLrc(originalText);
  let lines: LyricsLine[] =
    parsedOriginal.lines.length > 0
      ? parsedOriginal.lines.map((line) => {
          const wordLine = wordLines.find(
            (word) => Math.abs(word.startMs - line.startMs) <= 180,
          );
          return wordLine
            ? {
                ...line,
                endMs: wordLine.endMs,
                wordSegments: wordLine.wordSegments,
              }
            : line;
        })
      : wordLines;

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

  lines = lines.map((line) => {
    const translationSegments = deriveTranslationSegments(
      line.translation,
      line.wordSegments,
    );
    return translationSegments ? { ...line, translationSegments } : line;
  });

  return buildProviderResult(
    "qq",
    track,
    candidate,
    lines,
    unsyncedTranslation,
  );
}

export class QQMusicProvider {
  readonly id: ProviderId = "qq";
  readonly label = "QQ音乐";
  readonly providesTranslations = true;

  async search(
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<ProviderCandidate[]> {
    const variants = searchTrackVariants(track);
    const desktop = await Promise.allSettled(
      variants.map((variant) => searchDesktop(variant, signal)),
    );
    const desktopCandidates = dedupeProviderCandidates(
      desktop.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
    );
    if (desktopCandidates.length) return desktopCandidates;

    const mobile = await Promise.allSettled(
      variants.map((variant) => searchMobile(variant, signal)),
    );
    return dedupeProviderCandidates(
      mobile.flatMap((result) =>
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

