import { describe, expect, it } from "vitest";
import {
  attachWordSegments,
  deriveTranslationSegments,
  parseLrc,
  parseWordTimedLyrics,
  pairTranslations,
  unsyncedTranslationText,
} from "../src/core/lrc";

describe("LRC parsing", () => {
  it("parses offset, multiple timestamps, and metadata", () => {
    const parsed = parseLrc(
      [
        "[ar:Example]",
        "[offset:100]",
        "[00:01.00][00:03.50]First line",
        "[00:05.25]Second line",
      ].join("\n"),
    );
    expect(parsed.lines).toEqual([
      { startMs: 1_100, original: "First line" },
      { startMs: 3_600, original: "First line" },
      { startMs: 5_350, original: "Second line" },
    ]);
  });

  it("pairs translations by same-source timestamps", () => {
    const originals = parseLrc("[00:01.00]Hello\n[00:02.00]World").lines;
    const translations = parseLrc("[00:01.05]你好\n[00:02.00]世界").lines.map(
      (line) => ({ startMs: line.startMs, text: line.original }),
    );
    expect(pairTranslations(originals, translations)).toEqual([
      { startMs: 1_000, original: "Hello", translation: "你好" },
      { startMs: 2_000, original: "World", translation: "世界" },
    ]);
  });

  it("extracts non-synced translation text without metadata", () => {
    expect(
      unsyncedTranslationText("[ar:Example]\n第一行\n第二行"),
    ).toBe("第一行\n第二行");
  });
});

describe("word timing", () => {
  it("parses YRC-style lines and segments", () => {
    const parsed = parseWordTimedLyrics(
      "[1000,2000](1000,500,0)Hello (1500,500,0)world",
    );
    expect(parsed[0]?.original).toBe("Hello world");
    expect(parsed[0]?.wordSegments).toEqual([
      { startMs: 1_000, endMs: 1_500, text: "Hello " },
      { startMs: 1_500, endMs: 2_000, text: "world" },
    ]);
  });

  it("parses QQ QRC segments without the third timing field", () => {
    const parsed = parseWordTimedLyrics(
      "[1000,2000]Hello(1000,500) world(1500,500)",
    );
    expect(parsed[0]?.original).toBe("Hello world");
    expect(parsed[0]?.wordSegments).toEqual([
      { startMs: 1_000, endMs: 1_500, text: "Hello" },
      { startMs: 1_500, endMs: 2_000, text: " world" },
    ]);
  });

  it("attaches word timing and distributes translation segments", () => {
    const lines = attachWordSegments(
      [{ startMs: 1_000, original: "Hello world" }],
      parseWordTimedLyrics(
        "[1000,2000](1000,500,0)Hello (1500,500,0)world",
      ),
    );
    const segments = deriveTranslationSegments(
      "你好世界",
      lines[0]?.wordSegments,
    );
    expect(segments?.map((segment) => segment.text).join("")).toBe("你好世界");
    expect(segments?.[0]?.startMs).toBe(1_000);
  });
});

