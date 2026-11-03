import type {
  ProviderCandidate,
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
import { parseLrc } from "../core/lrc";
import {
  buildProviderResult,
  dedupeProviderCandidates,
  searchTrackVariants,
} from "./common";

function mapRecord(value: unknown): ProviderCandidate | undefined {
  const record = asRecord(value);
  const id = asString(record.id);
  const title = asString(record.trackName);
  if (!id || !title) return undefined;
  return {
    providerId: "lrclib",
    sourceId: id,
    title,
    artists: asString(record.artistName)
      .split(/\s*,\s*|\s+&\s+/)
      .filter(Boolean),
    album: asString(record.albumName),
    durationMs: (Number(record.duration) || 0) * 1_000,
    sourceUrl: `https://lrclib.net/api/get/${encodeURIComponent(id)}`,
    sourceLabel: "LRCLIB",
  };
}

async function fetchRecord(
  candidate: ProviderCandidate,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await requestJson<unknown>(
      `https://lrclib.net/api/get/${encodeURIComponent(candidate.sourceId)}`,
      { signal },
    );
  } catch {
    const params = new URLSearchParams({
      track_name: candidate.title,
      artist_name: candidate.artists.join(" "),
      album_name: candidate.album,
      duration: String(candidate.durationMs / 1_000),
    });
    return requestJson<unknown>(
      `https://lrclib.net/api/get?${params.toString()}`,
      { signal },
    );
  }
}

async function buildResult(
  candidate: ProviderCandidate,
  track: TrackInfo,
  signal: AbortSignal,
): Promise<ProviderResult> {
  const record = asRecord(await fetchRecord(candidate, signal));
  const synced = asString(record.syncedLyrics);
  const plain = asString(record.plainLyrics);
  const lines = synced
    ? parseLrc(synced).lines
    : plain
        .split("\n")
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text, index) => ({ startMs: index * 1_000, original: text }));
  if (!lines.length) throw new Error("LRCLIB 没有返回可用歌词。");
  return buildProviderResult("lrclib", track, candidate, lines);
}

export class LrclibProvider {
  readonly id: ProviderId = "lrclib";
  readonly label = "LRCLIB";
  readonly providesTranslations = false;

  async search(
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<ProviderCandidate[]> {
    const variants = searchTrackVariants(track);
    const results = await Promise.allSettled(
      variants.map(async (variant) => {
        const params = new URLSearchParams({
          track_name: variant.title,
          artist_name: variant.artists.join(" "),
          album_name: variant.album,
        });
        const response = await requestJson<unknown>(
          `https://lrclib.net/api/search?${params.toString()}`,
          { signal },
        );
        return asArray(response)
          .map(mapRecord)
          .filter((candidate): candidate is ProviderCandidate =>
            Boolean(candidate),
          );
      }),
    );
    return dedupeProviderCandidates(
      results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
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

export function lrclibResultTrack(value: unknown): string {
  return asString(readPath(value, ["trackName"]));
}

