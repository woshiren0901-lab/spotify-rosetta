import { describe, expect, it } from "vitest";
import {
  attachTranslations,
  parseRichsync,
  parseSubtitle,
} from "../src/providers/musixmatch";
import { parseSpotifyLines } from "../src/providers/spotify";
import { extractNewXmlValue } from "../src/providers/qq";

describe("Musixmatch parsing", () => {
  it("parses richsync words and absolute times", () => {
    const lines = parseRichsync(
      JSON.stringify([
        {
          ts: 10,
          te: 12,
          l: [
            { c: "Hello ", o: 0 },
            { c: "world", o: 0.8 },
          ],
        },
      ]),
    );
    expect(lines[0]?.original).toBe("Hello world");
    expect(lines[0]?.wordSegments).toHaveLength(2);
    expect(lines[0]?.wordSegments?.[1]?.startMs).toBe(10_800);
  });

  it("parses subtitle JSON", () => {
    const lines = parseSubtitle(
      JSON.stringify([{ time: { total: 3.125 }, text: "Subtitle line" }]),
    );
    expect(lines).toEqual([{ startMs: 3_125, original: "Subtitle line" }]);
  });

  it("attaches matched translations and preserves unmatched text", () => {
    const attached = attachTranslations(
      [
        { startMs: 1, original: "Hello world" },
        { startMs: 2, original: "Second line" },
      ],
      [
        { matchedLine: "Hello world", translation: "你好世界" },
        { matchedLine: "", translation: "没有匹配的译文" },
      ],
    );
    expect(attached.lines[0]?.translation).toBe("你好世界");
    expect(attached.lines[1]?.translation).toBeUndefined();
    expect(attached.unsynced).toBe("没有匹配的译文");
  });
});

describe("Spotify lyrics parsing", () => {
  it("parses native line and syllable timings", () => {
    const lines = parseSpotifyLines({
      lyrics: {
        lines: [
          {
            startTimeMs: "1000",
            endTimeMs: "2500",
            words: "Hello world",
            syllables: [
              { startTimeMs: "1000", numChars: 6, numCharsOffset: 0 },
              { startTimeMs: "1700", numChars: 5, numCharsOffset: 6 },
            ],
          },
        ],
      },
    });
    expect(lines).toEqual([
      {
        startMs: 1_000,
        endMs: 2_500,
        original: "Hello world",
        wordSegments: [
          { startMs: 1_000, endMs: 1_700, text: "Hello " },
          { startMs: 1_700, endMs: 2_500, text: "world" },
        ],
      },
    ]);
  });
});

describe("QQ detailed lyrics parsing", () => {
  it("unwraps CDATA translation content", () => {
    expect(
      extractNewXmlValue(
        {
          xml: "<contentts><![CDATA[[00:01.00]现成译文]]></contentts>",
        },
        "contentts",
      ),
    ).toBe("[00:01.00]现成译文");
  });
});

