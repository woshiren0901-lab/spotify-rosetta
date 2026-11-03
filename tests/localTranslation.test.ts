import { describe, expect, it } from "vitest";
import { parseLocalTranslation } from "../src/core/localTranslation";
import type { LyricsLine, TrackInfo } from "../src/types";

const track: TrackInfo = {
  id: "localTrack1",
  uri: "spotify:track:localTrack1",
  title: "Local Song",
  artists: ["Local Artist"],
  album: "Local Album",
  durationMs: 180_000,
};

const nativeLines: LyricsLine[] = [
  { startMs: 1_000, original: "Hello world" },
  { startMs: 2_000, original: "Second line" },
];

describe("local bilingual translation import", () => {
  it("pairs bilingual LRC lines with matching timestamps", () => {
    const result = parseLocalTranslation(
      [
        "[00:01.00]Hello world",
        "[00:01.00]你好世界",
        "[00:02.00]Second line",
        "[00:02.00]第二行",
      ].join("\n"),
      {
        track,
        sourceName: "https://example.com/translation",
        nativeLines,
      },
    );
    expect(result.providerId).toBe("local");
    expect(result.translationCoverage).toBe(1);
    expect(result.lines.map((line) => line.translation)).toEqual([
      "你好世界",
      "第二行",
    ]);
    expect(result.attributionUrl).toBe("https://example.com/translation");
  });

  it("binds a translation-only LRC to Spotify native originals by time", () => {
    const result = parseLocalTranslation(
      "[00:01.05]你好世界\n[00:02.00]第二行",
      {
        track,
        sourceName: "fan-sub.lrc",
        nativeLines,
      },
    );
    expect(result.lines).toEqual([
      {
        startMs: 1_000,
        original: "Hello world",
        translation: "你好世界",
      },
      {
        startMs: 2_000,
        original: "Second line",
        translation: "第二行",
      },
    ]);
  });

  it("accepts JSON translations and fills missing originals from Spotify", () => {
    const result = parseLocalTranslation(
      JSON.stringify({
        lines: [
          { startMs: 1_000, translation: "你好世界" },
          { startMs: 2_000, translation: "第二行" },
        ],
      }),
      {
        track,
        sourceName: "translation.json",
        nativeLines,
      },
    );
    expect(result.lines.map((line) => line.original)).toEqual([
      "Hello world",
      "Second line",
    ]);
    expect(result.translationCoverage).toBe(1);
  });
});
