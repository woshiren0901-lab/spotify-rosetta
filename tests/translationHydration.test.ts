import { describe, expect, it } from "vitest";
import { hydrateTranslationOnlyResult } from "../src/core/translationHydration";
import type { ProviderResult } from "../src/types";

function result(): ProviderResult {
  return {
    providerId: "web",
    candidate: {
      providerId: "web",
      sourceId: "source",
      title: "Example",
      artists: ["Artist"],
      album: "Album",
      durationMs: 120_000,
    },
    matchScore: 1,
    translationCoverage: 0,
    fidelity: "original-only",
    lines: [
      { startMs: 0, original: "", translation: "第一句" },
      { startMs: 0, original: "", translation: "第二句" },
    ],
    fetchedAt: 1,
  };
}

describe("translation-only hydration", () => {
  it("maps equal-length translations onto Spotify native lines", () => {
    const hydrated = hydrateTranslationOnlyResult(result(), [
      { startMs: 1_000, original: "First line" },
      { startMs: 2_000, original: "Second line" },
    ]);
    expect(hydrated.translationCoverage).toBe(1);
    expect(hydrated.fidelity).toBe("line");
    expect(hydrated.lines.map((line) => line.translation)).toEqual([
      "第一句",
      "第二句",
    ]);
  });

  it("uses an unsynced block when line counts differ", () => {
    const hydrated = hydrateTranslationOnlyResult(result(), [
      { startMs: 1_000, original: "Only native line" },
    ]);
    expect(hydrated.fidelity).toBe("unsynced");
    expect(hydrated.unsyncedTranslation).toBe("第一句\n第二句");
    expect(hydrated.lines[0]?.original).toBe("Only native line");
  });
});
