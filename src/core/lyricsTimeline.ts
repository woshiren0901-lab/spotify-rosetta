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
