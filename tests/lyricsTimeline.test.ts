import { describe, expect, it } from "vitest";
import {
  canSeekLyricLine,
  canSeekLyrics,
} from "../src/core/lyricsTimeline";
import type { ProviderResult } from "../src/types";

function result(
  overrides: Partial<ProviderResult> = {},
): ProviderResult {
  return {
    providerId: "netease",
    candidate: {
      providerId: "netease",
      sourceId: "source",
      title: "Song",
      artists: ["Artist"],
      album: "Album",
      durationMs: 180_000,
    },
    matchScore: 1,
    translationCoverage: 1,
    fidelity: "line",
    lines: [
      { startMs: 0, original: "First line", translation: "第一句" },
      { startMs: 12_345, original: "Second line", translation: "第二句" },
    ],
    fetchedAt: 1,
    ...overrides,
  };
}

describe("lyrics timeline seeking", () => {
  it("allows real timed lines, including a line at zero", () => {
    const timed = result();
    expect(canSeekLyrics(timed)).toBe(true);
    expect(canSeekLyricLine(timed, timed.lines[0]!)).toBe(true);
    expect(canSeekLyricLine(timed, timed.lines[1]!)).toBe(true);
  });

  it("rejects unsynchronized and synthetic plain-text timelines", () => {
    expect(canSeekLyrics(result({ fidelity: "unsynced" }))).toBe(false);
    expect(
      canSeekLyrics(
        result({
          fidelity: "original-only",
          lines: [
            { startMs: 0, original: "One" },
            { startMs: 1_000, original: "Two" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("rejects invalid line timestamps", () => {
    const timed = result();
    expect(
      canSeekLyricLine(timed, {
        startMs: Number.NaN,
        original: "Invalid",
        translation: "无效",
      }),
    ).toBe(false);
  });
});
