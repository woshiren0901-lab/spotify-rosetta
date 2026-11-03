import type { LyricsLine } from "../types";
import { normalizeLyricText } from "./normalize";

const MAX_BLOCK_LINES = 6;
const MIN_FUZZY_LENGTH = 4;

interface TextMatch {
  similarity: number;
  score: number;
}

interface BackPointer {
  previousNative: number;
  previousProvider: number;
  nativeCount: number;
  providerCount: number;
  score: number;
}

function hasTranslation(line: LyricsLine): boolean {
  return Boolean(line.translation?.trim()) || Boolean(line.translationSegments?.length);
}

function translationText(line: LyricsLine): string {
  return (
    line.translation?.trim() ||
    line.translationSegments?.map((segment) => segment.text).join("") ||
    ""
  );
}

function levenshteinSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        (previous[rightIndex - 1] ?? 0) +
        (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        substitution,
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index] ?? 0;
    }
  }
  return 1 - (previous[right.length] ?? 0) / Math.max(left.length, right.length);
}

function normalizedBlock(lines: LyricsLine[]): string {
  return lines
    .map((line) => normalizeLyricText(line.original))
    .join("");
}

function timeCompatibility(nativeLines: LyricsLine[], providerLines: LyricsLine[]): number {
  const nativeStart = nativeLines[0]?.startMs;
  const providerStart = providerLines[0]?.startMs;
  if (!Number.isFinite(nativeStart) || !Number.isFinite(providerStart)) return 1;
  const difference = Math.abs((nativeStart ?? 0) - (providerStart ?? 0));
  return Math.max(0.5, 1 - difference / 45_000);
}

function matchBlock(
  nativeLines: LyricsLine[],
  providerLines: LyricsLine[],
): TextMatch | undefined {
  const nativeText = normalizedBlock(nativeLines);
  const providerText = normalizedBlock(providerLines);
  if (!nativeText || !providerText) return undefined;

  const shortest = Math.min(nativeText.length, providerText.length);
  const longest = Math.max(nativeText.length, providerText.length);
  if (nativeText !== providerText) {
    if (
      longest <= MIN_FUZZY_LENGTH ||
      shortest < MIN_FUZZY_LENGTH ||
      shortest / longest < 0.55
    ) {
      return undefined;
    }
  }

  const similarity = levenshteinSimilarity(nativeText, providerText);
  if (nativeText !== providerText) {
    const threshold =
      longest <= 8 ? 0.7 : longest <= 16 ? 0.66 : 0.62;
    if (similarity < threshold) return undefined;
  }

  const score =
    similarity * 0.88 +
    timeCompatibility(nativeLines, providerLines) * 0.12;
  return { similarity, score };
}

function combineTranslationLines(
  nativeLines: LyricsLine[],
  providerLines: LyricsLine[],
): LyricsLine | undefined {
  const translated = providerLines.filter(hasTranslation);
  if (!translated.length) return undefined;

  const allSegmented = translated.every(
    (line) => line.translationSegments?.length,
  );
  return {
    startMs: nativeLines[0]?.startMs ?? providerLines[0]?.startMs ?? 0,
    endMs: nativeLines.at(-1)?.endMs ?? nativeLines.at(-1)?.startMs,
    original: nativeLines.map((line) => line.original).join(" "),
    translation: translated.map(translationText).filter(Boolean).join(" "),
    translationSegments: allSegmented
      ? translated.flatMap((line) => line.translationSegments ?? [])
      : undefined,
  };
}

/**
 * Aligns two monotonic lyric sequences. A block can map one native line to
 * several provider lines (Spotify merged lines) or one provider line to
 * several native lines (Spotify split lines).
 */
export function alignLyricSequences(
  nativeLines: LyricsLine[],
  providerLines: LyricsLine[],
): LyricsLine[] {
  if (!nativeLines.length || !providerLines.length) return [];

  const rows = nativeLines.length + 1;
  const columns = providerLines.length + 1;
  const scores = Array.from({ length: rows }, () =>
    new Array<number>(columns).fill(Number.NEGATIVE_INFINITY),
  );
  const paths = Array.from({ length: rows }, () =>
    new Array<BackPointer | undefined>(columns).fill(undefined),
  );
  scores[0]![0] = 0;

  for (let nativeIndex = 1; nativeIndex < rows; nativeIndex += 1) {
    scores[nativeIndex]![0] = 0;
    paths[nativeIndex]![0] = {
      previousNative: nativeIndex - 1,
      previousProvider: 0,
      nativeCount: 1,
      providerCount: 0,
      score: 0,
    };
  }
  for (let providerIndex = 1; providerIndex < columns; providerIndex += 1) {
    scores[0]![providerIndex] = 0;
    paths[0]![providerIndex] = {
      previousNative: 0,
      previousProvider: providerIndex - 1,
      nativeCount: 0,
      providerCount: 1,
      score: 0,
    };
  }

  for (let nativeIndex = 1; nativeIndex < rows; nativeIndex += 1) {
    for (let providerIndex = 1; providerIndex < columns; providerIndex += 1) {
      let bestScore = scores[nativeIndex - 1]![providerIndex] ?? 0;
      let best: BackPointer = {
        previousNative: nativeIndex - 1,
        previousProvider: providerIndex,
        nativeCount: 1,
        providerCount: 0,
        score: 0,
      };

      const providerSkip = scores[nativeIndex]![providerIndex - 1] ?? 0;
      if (providerSkip > bestScore) {
        bestScore = providerSkip;
        best = {
          previousNative: nativeIndex,
          previousProvider: providerIndex - 1,
          nativeCount: 0,
          providerCount: 1,
          score: 0,
        };
      }

      for (
        let providerCount = 1;
        providerCount <= Math.min(MAX_BLOCK_LINES, providerIndex);
        providerCount += 1
      ) {
        const match = matchBlock(
          [nativeLines[nativeIndex - 1]!],
          providerLines.slice(providerIndex - providerCount, providerIndex),
        );
        if (!match) continue;
        const previous =
          scores[nativeIndex - 1]![providerIndex - providerCount] ?? 0;
        const candidate = previous + match.score;
        if (candidate > bestScore) {
          bestScore = candidate;
          best = {
            previousNative: nativeIndex - 1,
            previousProvider: providerIndex - providerCount,
            nativeCount: 1,
            providerCount,
            score: match.score,
          };
        }
      }

      for (
        let nativeCount = 2;
        nativeCount <= Math.min(MAX_BLOCK_LINES, nativeIndex);
        nativeCount += 1
      ) {
        const match = matchBlock(
          nativeLines.slice(nativeIndex - nativeCount, nativeIndex),
          [providerLines[providerIndex - 1]!],
        );
        if (!match) continue;
        const previous =
          scores[nativeIndex - nativeCount]![providerIndex - 1] ?? 0;
        const candidate = previous + match.score;
        if (candidate > bestScore) {
          bestScore = candidate;
          best = {
            previousNative: nativeIndex - nativeCount,
            previousProvider: providerIndex - 1,
            nativeCount,
            providerCount: 1,
            score: match.score,
          };
        }
      }

      scores[nativeIndex]![providerIndex] = bestScore;
      paths[nativeIndex]![providerIndex] = best;
    }
  }

  const aligned: LyricsLine[] = [];
  let nativeIndex = nativeLines.length;
  let providerIndex = providerLines.length;
  while (nativeIndex > 0 || providerIndex > 0) {
    const path = paths[nativeIndex]?.[providerIndex];
    if (!path) break;
    if (path.nativeCount > 0 && path.providerCount > 0) {
      const nativeBlock = nativeLines.slice(
        path.previousNative,
        path.previousNative + path.nativeCount,
      );
      const providerBlock = providerLines.slice(
        path.previousProvider,
        path.previousProvider + path.providerCount,
      );
      const combined = combineTranslationLines(nativeBlock, providerBlock);
      if (combined && path.nativeCount > 1 && path.providerCount === 1) {
        for (const nativeLine of nativeBlock.slice().reverse()) {
          aligned.push({
            ...combined,
            original: nativeLine.original,
            startMs: nativeLine.startMs,
            endMs: nativeLine.endMs,
          });
        }
      } else if (combined) {
        aligned.push(combined);
      }
    }
    nativeIndex = path.previousNative;
    providerIndex = path.previousProvider;
  }

  return aligned.reverse();
}

export function lyricSourceMatchRatio(
  nativeLines: LyricsLine[],
  providerLines: LyricsLine[],
): number {
  const meaningfulNativeLines = nativeLines.filter(
    (line) => normalizeLyricText(line.original).length >= 2,
  );
  if (!meaningfulNativeLines.length) return 1;
  if (!providerLines.length) return 0;

  const probeLines = providerLines.map((line) => ({
    ...line,
    translation: line.translation || "\u0000",
  }));
  const matched = alignLyricSequences(nativeLines, probeLines);
  const matchedCount = matched.filter(
    (line) => normalizeLyricText(line.original).length >= 2,
  ).length;
  return Math.min(1, matchedCount / meaningfulNativeLines.length);
}
