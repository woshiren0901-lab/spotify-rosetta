import type {
  LyricsLine,
  ProviderCandidate,
  ProviderId,
  ProviderResult,
  TrackInfo,
} from "../types";
import {
  determineFidelity,
  translationCoverage as calculateCoverage,
} from "../core/normalize";
import { scoreCandidate } from "../core/ranking";

function uniqueValues(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

export function searchTrackVariants(track: TrackInfo): TrackInfo[] {
  const titles = uniqueValues([track.title, ...(track.titleAliases ?? [])]).slice(
    0,
    2,
  );
  const artistSets = [
    track.artists,
    ...(track.artistAliases ?? []).map((artist) => [artist]),
  ].filter((artists) => artists.length > 0);
  const primaryArtistSets = [
    track.artists,
    ...(track.artistAliases ?? []).slice(0, 1).map((artist) => [artist]),
  ].filter((artists) => artists.length > 0);
  const dedupedArtistSets = primaryArtistSets.filter(
    (artists, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.map((artist) => artist.toLocaleLowerCase()).join("|") ===
          artists.map((artist) => artist.toLocaleLowerCase()).join("|"),
      ) === index,
  );
  const variants: TrackInfo[] = [];
  const seen = new Set<string>();
  for (const title of titles) {
    for (const artists of dedupedArtistSets) {
      const key = `${title.toLocaleLowerCase()}|${artists.join("|").toLocaleLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({ ...track, title, artists });
      if (variants.length >= 4) return variants;
    }
  }
  if (!variants.length) {
    variants.push({ ...track, artists: artistSets[0] ?? track.artists });
  }
  return variants;
}

export function dedupeProviderCandidates(
  candidates: ProviderCandidate[],
): ProviderCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.providerId}:${candidate.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildProviderResult(
  providerId: ProviderId,
  track: TrackInfo,
  candidate: ProviderCandidate,
  lines: LyricsLine[],
  unsyncedTranslation?: string,
  attributionUrl?: string,
): ProviderResult {
  const coverage = calculateCoverage(lines);
  return {
    providerId,
    candidate,
    matchScore: scoreCandidate(track, candidate).matchScore,
    translationCoverage: coverage,
    fidelity: determineFidelity(lines, unsyncedTranslation),
    lines,
    unsyncedTranslation: unsyncedTranslation?.trim() || undefined,
    attributionUrl: attributionUrl ?? candidate.sourceUrl,
    fetchedAt: Date.now(),
  };
}

export function hasTimestamps(value: string): boolean {
  return /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(value);
}

export function hasWordTimestamps(value: string): boolean {
  return /\[\d+,\d+\].*\(\d+,\d+(?:,-?\d+)?\)/s.test(value);
}

