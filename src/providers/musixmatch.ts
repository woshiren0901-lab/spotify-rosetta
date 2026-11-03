import type {
  LyricsLine,
  ProviderCandidate,
  ProviderId,
  ProviderResult,
  TrackInfo,
  WordSegment,
} from "../types";
import {
  asArray,
  asRecord,
  asString,
  readPath,
  requestJson,
} from "../core/http";
import {
  deriveTranslationSegments,
  parseLrc,
  unsyncedTranslationText,
} from "../core/lrc";
import { normalizeIsrc, normalizeLyricText } from "../core/normalize";
import {
  buildProviderResult,
  dedupeProviderCandidates,
  searchTrackVariants,
} from "./common";

const API_BASES = [
  {
    base: "https://apic-appmobile.musixmatch.com/ws/1.1/",
    appId: "mac-ios-v2.0",
  },
  {
    base: "https://apic-desktop.musixmatch.com/ws/1.1/",
    appId: "web-desktop-app-v1.0",
  },
  {
    base: "https://apic.musixmatch.com/ws/1.1/",
    appId: "android-player-v1.0",
  },
] as const;

const HEADERS: Record<string, string> = {
  Cookie: "AWSELB=0; AWSELBCORS=0",
  Accept: "application/json",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
  "x-mxm-app-version": "10.1.1",
  "X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
};

let cachedToken = "";
let cachedTokenAt = 0;
let activeBaseIndex = 0;

function requestId(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

function endpoint(path: string): { url: string; appId: string } {
  const config = API_BASES[activeBaseIndex] ?? API_BASES[0];
  return {
    url: `${config.base}${path}`,
    appId: config.appId,
  };
}

async function getUserToken(signal: AbortSignal, force = false): Promise<string> {
  if (!force && cachedToken && Date.now() - cachedTokenAt < 30 * 60_000) {
    return cachedToken;
  }
  const attempts = API_BASES.map(async (config, index) => {
    const url =
      `${config.base}token.get?user_language=en` +
      `&app_id=${encodeURIComponent(config.appId)}` +
      `&t=${encodeURIComponent(requestId())}`;
    const response = await requestJson<unknown>(url, {
      signal,
      headers: HEADERS,
    });
    const token = asString(
      readPath(response, ["message", "body", "user_token"]),
    );
    if (!token || token === "null" || !/[1-9a-f]/i.test(token)) {
      throw new Error("Musixmatch token response was empty.");
    }
    return { token, index };
  });
  try {
    const result = await Promise.any(attempts);
    cachedToken = result.token;
    cachedTokenAt = Date.now();
    activeBaseIndex = result.index;
    return result.token;
  } catch (error) {
    const cause =
      error instanceof AggregateError ? error.errors[0] : error;
    throw cause instanceof Error
      ? cause
      : new Error("无法取得 Musixmatch 匿名 token。");
  }
}

function withTokenUrl(
  path: string,
  token: string,
): string {
  const { url, appId } = endpoint(path);
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}usertoken=${encodeURIComponent(token)}&format=json&app_id=${encodeURIComponent(appId)}&t=${encodeURIComponent(requestId())}`;
}

function mapTrack(value: unknown): ProviderCandidate | undefined {
  const track = asRecord(value);
  const id = asString(track.track_id);
  const title = asString(track.track_name);
  if (!id || !title) return undefined;
  const artists = asString(track.artist_name)
    .split(/\s*,\s*|\s+&\s+/)
    .map((artist) => artist.trim())
    .filter(Boolean);
  return {
    providerId: "musixmatch",
    sourceId: id,
    title,
    artists,
    album: asString(track.album_name),
    durationMs: (Number(track.track_length) || 0) * 1_000,
    isrc: normalizeIsrc(asString(track.track_isrc)),
    sourceUrl: `https://www.musixmatch.com/lyrics/${encodeURIComponent(
      artists[0] ?? "unknown",
    )}/${encodeURIComponent(title)}`,
    sourceLabel: "Musixmatch",
  };
}

export function parseRichsync(
  richsyncText: string,
): LyricsLine[] {
  try {
    const items = JSON.parse(richsyncText) as unknown[];
    const parsed: LyricsLine[] = [];
    for (const value of asArray(items)) {
      const item = asRecord(value);
      const startMs = Number(item.ts) * 1_000;
      const endMs = Number(item.te) * 1_000;
      const chunks = asArray(item.l).map(asRecord);
      const text = chunks.map((chunk) => asString(chunk.c)).join("").trim();
      if (!Number.isFinite(startMs) || !text) continue;
      const wordSegments: WordSegment[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const chunkText = asString(chunk?.c);
        if (!chunk || !chunkText) continue;
        const chunkStart = startMs + (Number(chunk.o) || 0) * 1_000;
        const nextStart =
          index + 1 < chunks.length
            ? startMs + (Number(chunks[index + 1]?.o) || 0) * 1_000
            : endMs;
        wordSegments.push({
          startMs: Math.max(startMs, chunkStart),
          endMs: Math.max(chunkStart + 1, nextStart),
          text: chunkText,
        });
      }
      parsed.push({
        startMs,
        endMs,
        original: text,
        wordSegments: wordSegments.length ? wordSegments : undefined,
      });
    }
    return parsed;
  } catch {
    return [];
  }
}

export function parseSubtitle(subtitleBody: string): LyricsLine[] {
  if (subtitleBody.trim().startsWith("[")) {
    try {
      const items = JSON.parse(subtitleBody) as unknown[];
      return asArray(items)
        .map((value) => {
          const item = asRecord(value);
          const startMs =
            Number(readPath(item, ["time", "total"])) * 1_000 ||
            Number(item.time) * 1_000;
          const text = asString(item.text).trim();
          if (!text || !Number.isFinite(startMs)) return undefined;
          return { startMs, original: text } satisfies LyricsLine;
        })
        .filter((line): line is LyricsLine => Boolean(line));
    } catch {
      // Continue with an LRC parse.
    }
  }
  return parseLrc(subtitleBody).lines;
}

function translationPairsFromResponse(response: unknown): Array<{
  translation: string;
  matchedLine: string;
}> {
  const list =
    readPath(response, ["message", "body", "translations_list"]) ?? [];
  return asArray(list)
    .map((value) => {
      const translation = asRecord(asRecord(value).translation);
      return {
        translation: asString(translation.description).trim(),
        matchedLine: asString(translation.matched_line).trim(),
      };
    })
    .filter((translation) => Boolean(translation.translation));
}

export function attachTranslations(
  lines: LyricsLine[],
  translations: Array<{ translation: string; matchedLine: string }>,
): { lines: LyricsLine[]; unsynced?: string } {
  const byLine = new Map<string, string[]>();
  const unmatched: string[] = [];
  for (const entry of translations) {
    const key = normalizeLyricText(entry.matchedLine);
    if (!key) {
      unmatched.push(entry.translation);
      continue;
    }
    const queue = byLine.get(key) ?? [];
    queue.push(entry.translation);
    byLine.set(key, queue);
  }

  const paired = lines.map((line) => {
    const exact = normalizeLyricText(line.original);
    const queue = byLine.get(exact);
    if (queue?.length) {
      const translation = queue.shift();
      return translation ? { ...line, translation } : line;
    }
    const fuzzyKey = [...byLine.keys()].find((key) => {
      if (!key || !exact) return false;
      return exact.includes(key) || key.includes(exact);
    });
    const fuzzyQueue = fuzzyKey ? byLine.get(fuzzyKey) : undefined;
    if (fuzzyQueue?.length) {
      const translation = fuzzyQueue.shift();
      if (translation) return { ...line, translation };
    }
    return line;
  });

  for (const queue of byLine.values()) unmatched.push(...queue);
  return {
    lines: paired,
    unsynced: unmatched.length ? unmatched.join("\n") : undefined,
  };
}

async function buildResult(
  candidate: ProviderCandidate,
  track: TrackInfo,
  signal: AbortSignal,
): Promise<ProviderResult> {
  const token = await getUserToken(signal);
  const lyricsPath =
    "macro.subtitles.get?namespace=lyrics_richsynched" +
    "&optional_calls=track.richsync&subtitle_format=mxm" +
    `&track_id=${encodeURIComponent(candidate.sourceId)}` +
    "&comment_format=text&part=track_lyrics_translation_status";
  const translationPath =
    "crowd.track.translations.get?translation_fields_set=minimal" +
    "&selected_language=zh" +
    `&track_id=${encodeURIComponent(candidate.sourceId)}` +
    "&comment_format=text&part=user";

  const [lyricsResponse, translationResponse] = await Promise.all([
    requestJson<unknown>(withTokenUrl(lyricsPath, token), {
      signal,
      headers: HEADERS,
    }),
    requestJson<unknown>(withTokenUrl(translationPath, token), {
      signal,
      headers: HEADERS,
    }),
  ]);

  const calls =
    readPath(lyricsResponse, ["message", "body", "macro_calls"]) ??
    readPath(lyricsResponse, ["message", "body"]) ??
    {};
  const richsync = asString(
    readPath(calls, [
      "track.richsync.get",
      "message",
      "body",
      "richsync",
      "richsync_body",
    ]),
  );
  const subtitle = asString(
    readPath(calls, [
      "track.subtitles.get",
      "message",
      "body",
      "subtitle_list",
      0,
      "subtitle",
      "subtitle_body",
    ]),
  );
  const unsyncedLyrics = asString(
    readPath(calls, [
      "track.lyrics.get",
      "message",
      "body",
      "lyrics",
      "lyrics_body",
    ]),
  );

  let lines = parseRichsync(richsync);
  if (!lines.length && subtitle) lines = parseSubtitle(subtitle);
  if (!lines.length && unsyncedLyrics) {
    lines = unsyncedLyrics
      .split("\n")
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text, index) => ({ startMs: index * 1_000, original: text }));
  }
  if (!lines.length) {
    throw new Error("Musixmatch 没有返回可用歌词。");
  }

  const pairs = translationPairsFromResponse(translationResponse);
  const attached = attachTranslations(lines, pairs);
  if (
    !attached.lines.some(
      (line) => line.translation?.trim() || line.translationSegments?.length,
    ) &&
    !attached.unsynced?.trim()
  ) {
    throw new Error("Musixmatch 条目没有现成 crowd translation。");
  }
  lines = attached.lines.map((line) => {
    const translationSegments = deriveTranslationSegments(
      line.translation,
      line.wordSegments,
    );
    return translationSegments ? { ...line, translationSegments } : line;
  });

  return buildProviderResult(
    "musixmatch",
    track,
    candidate,
    lines,
    attached.unsynced
      ? unsyncedTranslationText(attached.unsynced)
      : undefined,
  );
}

export class MusixmatchProvider {
  readonly id: ProviderId = "musixmatch";
  readonly label = "Musixmatch";
  readonly providesTranslations = true;

  async search(
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<ProviderCandidate[]> {
    let token = await getUserToken(signal);
    const variants = searchTrackVariants(track);
    const loadVariant = async (variant: TrackInfo): Promise<ProviderCandidate[]> => {
      const duration =
        variant.durationMs > 0 ? Math.round(variant.durationMs / 1_000) : 0;
      const path =
        "track.search?page_size=10&page=1&s_track_rating=desc" +
        `&q_track=${encodeURIComponent(variant.title)}` +
        `&q_artist=${encodeURIComponent(variant.artists.join(" "))}` +
        (duration ? `&q_duration=${duration}` : "");
      const response = await requestJson<unknown>(withTokenUrl(path, token), {
        signal,
        headers: HEADERS,
      });
      const list = readPath(response, ["message", "body", "track_list"]) ?? [];
      return asArray(list)
        .map((item) => mapTrack(asRecord(item).track))
        .filter((candidate): candidate is ProviderCandidate =>
          Boolean(candidate),
        );
    };

    let responses = await Promise.allSettled(variants.map(loadVariant));
    if (responses.every((response) => response.status === "rejected")) {
      cachedToken = "";
      token = await getUserToken(signal, true);
      responses = await Promise.allSettled(variants.map(loadVariant));
    }
    return dedupeProviderCandidates(
      responses.flatMap((response) =>
        response.status === "fulfilled" ? response.value : [],
      ),
    );
  }

  async fetch(
    candidate: ProviderCandidate,
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<ProviderResult> {
    return buildResult(candidate, track, signal);
  }
}

