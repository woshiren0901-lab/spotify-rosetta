import type { LyricsLine, ProviderResult } from "../types";

const SYNTHETIC_STEP_MS = 1_000;

/**
 * Some providers turn plain, untimed lyrics into synthetic 0s, 1s, 2s...
 * timestamps. Those values are useful for stable ordering, but not seeking.
 */
function hasSyntheticTimeline(lines: LyricsLine[]): boolean {
  return (
    lines.length > 1 &&
    lines.every(
      (line, index) =>
        Number.isFinite(line.startMs) &&
        line.startMs === index * SYNTHETIC_STEP_MS,
    )
  );
}

export function hasReliableLyricsTimeline(lines: LyricsLine[]): boolean {
  return (
    lines.length > 0 &&
    !hasSyntheticTimeline(lines) &&
    lines.some(
      (line) => Number.isFinite(line.startMs) && line.startMs > 0,
    )
  );
}

export function estimatedLyricLineIndex(
  lineCount: number,
  progressMs: number,
  durationMs: number,
): number {
  if (lineCount <= 0) return -1;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const progress = Math.max(0, Math.min(durationMs, progressMs));
  return Math.min(
    lineCount - 1,
    Math.max(0, Math.floor((progress / durationMs) * lineCount)),
  );
}

function estimatedLineWeight(line: LyricsLine): number {
  const text =
    line.original.trim() ||
    line.translation?.trim() ||
    line.translationSegments?.map((segment) => segment.text).join("") ||
    "";
  const length = Array.from(text).length;
  const pauseCount = (text.match(/[，。！？,.!?；;、…]/g) ?? []).length;
  return Math.max(6, Math.min(48, length + pauseCount * 2));
}

export function estimatedLyricLineIndexForLines(
  lines: LyricsLine[],
  progressMs: number,
  durationMs: number,
  offset = 0,
): number {
  if (!lines.length) return -1;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return Math.max(0, Math.min(lines.length - 1, offset));
  }

  const weights = lines.map(estimatedLineWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const ratio = Math.max(0, Math.min(1, progressMs / durationMs));
  const targetWeight = ratio * totalWeight;
  let cumulative = 0;
  let estimated = lines.length - 1;
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index] ?? 1;
    if (targetWeight < cumulative) {
      estimated = index;
      break;
    }
  }
  return Math.max(0, Math.min(lines.length - 1, estimated + offset));
}

export function canSeekLyrics(result: ProviderResult | undefined): boolean {
  if (
    !result ||
    result.fidelity === "unsynced" ||
    !result.lines.length ||
    !hasReliableLyricsTimeline(result.lines)
  ) {
    return false;
  }
  return true;
}

export function canSeekLyricLine(
  result: ProviderResult | undefined,
  line: LyricsLine,
): boolean {
  return (
    canSeekLyrics(result) &&
    Number.isFinite(line.startMs) &&
    line.startMs >= 0
  );
}
