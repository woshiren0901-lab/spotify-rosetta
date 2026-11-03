import type {
  ProviderResult,
  RankedCandidate,
  TrackInfo,
  ProviderCandidate,
  SyncFidelity,
  ProviderId,
} from "../types";
import {
  artistSimilarity,
  diceSimilarity,
  extractLanguageVersions,
  normalizeIsrc,
  normalizeLanguage,
  normalizeTitleBase,
  versionCompatibility,
} from "./normalize";

const PROVIDER_TIE_ORDER: ProviderId[] = [
  "netease",
  "qq",
  "musixmatch",
  "lyricstranslate",
  "web",
  "local",
  "spotify",
  "lrclib",
];

export function languageCompatibility(
  track: TrackInfo,
  candidate: ProviderCandidate,
): number {
  const expected = new Set<string>([
    ...(track.languageHints ?? [])
      .map(normalizeLanguage)
      .filter((language): language is string => Boolean(language)),
    ...extractLanguageVersions(
      [
        track.title,
        ...(track.titleAliases ?? []),
        track.album,
        ...(track.albumAliases ?? []),
      ].join(" "),
    ),
  ]);
  const actual = new Set<string>([
    ...extractLanguageVersions(`${candidate.title} ${candidate.album}`),
  ]);
  const candidateLanguage = normalizeLanguage(candidate.sourceLanguage);
  if (candidateLanguage) actual.add(candidateLanguage);

  if (!expected.size || !actual.size) return 0.65;
  return [...expected].some((language) => actual.has(language)) ? 1 : 0;
}

export function isrcCompatibility(
  track: TrackInfo,
  candidate: ProviderCandidate,
): number {
  const expected = normalizeIsrc(track.isrc);
  const actual = normalizeIsrc(candidate.isrc);
  if (!expected || !actual) return 0.65;
  return expected === actual ? 1 : 0;
}

export function scoreCandidate(
  track: TrackInfo,
  candidate: ProviderCandidate,
): RankedCandidate {
  const title = Math.max(
    ...[track.title, ...(track.titleAliases ?? [])].map((title) =>
      diceSimilarity(normalizeTitleBase(title), normalizeTitleBase(candidate.title)),
    ),
  );
  const artistSets = [
    track.artists,
    ...(track.artistAliases ?? []).map((artist) => [artist]),
  ];
  const artists = Math.max(
    ...artistSets.map((artists) => artistSimilarity(artists, candidate.artists)),
  );
  const album = Math.max(
    ...[track.album, ...(track.albumAliases ?? [])].map((album) =>
      diceSimilarity(album, candidate.album),
    ),
  );
  const duration =
    track.durationMs > 0 && candidate.durationMs > 0
      ? Math.max(
          0,
          1 - Math.abs(track.durationMs - candidate.durationMs) / 20_000,
        )
      : 0.5;
  const version = versionCompatibility(track, candidate);
  const language = languageCompatibility(track, candidate);
  const isrc = isrcCompatibility(track, candidate);
  const isrcExact = isrc === 1;
  const matchScore = Math.min(
    1,
    Math.max(
      0,
      title * 0.28 +
        artists * 0.18 +
        duration * 0.14 +
        album * 0.08 +
        version * 0.09 +
        language * 0.13 +
        isrc * 0.1,
    ),
  );
  const titlePass = isrcExact || title >= 0.72;
  const artistPass =
    isrcExact || artists >= 0.45 || !candidate.artists.length;
  const durationPass =
    isrcExact ||
    !track.durationMs ||
    !candidate.durationMs ||
    Math.abs(track.durationMs - candidate.durationMs) <= 15_000;
  const versionPass = isrcExact || version >= 0.35;
  const languagePass = isrcExact || language >= 0.35;
  const isrcPass = isrc >= 0.35;

  return {
    candidate,
    matchScore,
    eligible:
      isrcPass &&
      titlePass &&
      artistPass &&
      durationPass &&
      versionPass &&
      languagePass,
  };
}

function fidelityRank(fidelity: SyncFidelity): number {
  switch (fidelity) {
    case "word":
      return 4;
    case "line":
      return 3;
    case "unsynced":
      return 2;
    default:
      return 1;
  }
}

function providerRank(providerId: ProviderId): number {
  const index = PROVIDER_TIE_ORDER.indexOf(providerId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function compareProviderResults(
  left: ProviderResult,
  right: ProviderResult,
): number {
  if (left.matchScore !== right.matchScore) {
    return right.matchScore - left.matchScore;
  }
  if (left.translationCoverage !== right.translationCoverage) {
    return right.translationCoverage - left.translationCoverage;
  }
  const leftFidelity = fidelityRank(left.fidelity);
  const rightFidelity = fidelityRank(right.fidelity);
  if (leftFidelity !== rightFidelity) {
    return rightFidelity - leftFidelity;
  }
  return providerRank(left.providerId) - providerRank(right.providerId);
}

export function rankProviderResults(results: ProviderResult[]): ProviderResult[] {
  return results.slice().sort(compareProviderResults);
}

export function chooseBestResult(
  results: ProviderResult[],
  requireTranslation: boolean,
): ProviderResult | undefined {
  const candidates = results.filter((result) => {
    if (!requireTranslation) return true;
    return (
      result.fidelity !== "original-only" ||
      Boolean(result.unsyncedTranslation?.trim())
    );
  });
  return rankProviderResults(candidates)[0];
}

