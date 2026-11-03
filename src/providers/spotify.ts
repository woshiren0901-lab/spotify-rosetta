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
import { buildProviderResult } from "./common";

function currentCandidate(track: TrackInfo): ProviderCandidate {
  return {
    providerId: "spotify",
    sourceId: track.id,
    title: track.title,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    isrc: track.isrc,
    sourceUrl: `https://open.spotify.com/track/${encodeURIComponent(track.id)}`,
    sourceLabel: "Spotify",
  };
}

export function parseSpotifyLines(response: unknown): LyricsLine[] {
  const lines = asArray(readPath(response, ["lyrics", "lines"]));
  const parsed: LyricsLine[] = [];
  for (const value of lines) {
    const line = asRecord(value);
    const startMs = Number(asString(line.startTimeMs ?? 0));
    const endMs = Number(asString(line.endTimeMs ?? 0));
    const original = asString(line.words).trim();
    if (!original || !Number.isFinite(startMs)) continue;

    const syllables = asArray(line.syllables);
    const segments: WordSegment[] = [];
    if (syllables.length) {
      syllables.forEach((soundValue, index) => {
        const syllable = asRecord(soundValue);
        const syllableStart = Number(asString(syllable.startTimeMs ?? startMs));
        const next = asArray(line.syllables)[index + 1];
        const nextStart =
          next !== undefined
            ? Number(asString(asRecord(next).startTimeMs ?? endMs))
            : endMs || syllableStart + 300;
        const chars = Number(syllable.numChars || 0);
        const text =
          chars > 0
            ? original.slice(
                Number(asString(syllable.numCharsOffset ?? 0)),
                Number(asString(syllable.numCharsOffset ?? 0)) + chars,
              )
            : asString(syllable.syllables);
        if (text) {
          segments.push({
            startMs: syllableStart,
            endMs: Math.max(syllableStart + 1, nextStart),
            text,
          });
        }
      });
    }
    parsed.push({
      startMs,
      endMs: endMs || undefined,
      original,
      wordSegments: segments.length ? segments : undefined,
    });
  }
  return parsed;
}

export class SpotifyProvider {
  readonly id: ProviderId = "spotify";
  readonly label = "Spotify";
  readonly providesTranslations = false;

  async search(track: TrackInfo): Promise<ProviderCandidate[]> {
    return [currentCandidate(track)];
  }

  async fetch(
    _candidate: ProviderCandidate,
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<ProviderResult> {
    const candidate = currentCandidate(track);
    const response = await requestJson<unknown>(
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${encodeURIComponent(
        track.id,
      )}?format=json&vocalRemoval=false&market=from_token`,
      {
        signal,
        headers: {
          "app-platform": "WebPlayer",
        },
      },
    );
    const lines = parseSpotifyLines(response);
    if (!lines.length) throw new Error("Spotify 当前曲目没有原生歌词。");
    return buildProviderResult("spotify", track, candidate, lines);
  }
}

