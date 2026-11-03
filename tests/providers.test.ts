import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachTranslations,
  parseRichsync,
  parseSubtitle,
} from "../src/providers/musixmatch";
import { parseSpotifyLines } from "../src/providers/spotify";
import { extractNewXmlValue } from "../src/providers/qq";
import { NeteaseProvider } from "../src/providers/netease";
import type { ProviderCandidate, TrackInfo } from "../src/types";

afterEach(() => {
  window.Spicetify = undefined;
  vi.unstubAllGlobals();
});

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

describe("NetEase source fallback", () => {
  const track: TrackInfo = {
    id: "wu-bai-track",
    uri: "spotify:track:wu-bai-track",
    title: "挪威的森林",
    artists: ["伍佰 & China Blue"],
    album: "爱情的尽头",
    durationMs: 391_026,
  };
  const candidate: ProviderCandidate = {
    providerId: "netease",
    sourceId: "157288",
    title: track.title,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    sourceLabel: "网易云音乐",
  };

  function installChineseOriginalResponse(): void {
    window.Spicetify = {
      CosmosAsync: {
        get: async () =>
          ({
            lrc: {
              lyric:
                "[00:35.149]让我将你心儿摘下\n[00:38.621]试着将它慢慢溶化",
            },
            tlyric: { lyric: "" },
            klyric: { lyric: "" },
          }) as never,
        post: async () => {
          throw new Error("unexpected POST");
        },
      },
    };
  }

  it("keeps translation lookup strict by default", async () => {
    installChineseOriginalResponse();
    const provider = new NeteaseProvider();
    await expect(
      provider.fetch(candidate, track, new AbortController().signal),
    ).rejects.toThrow("没有 tlyric 现成译文");
  });

  it("returns matching source lyrics for a missing-native fallback only when allowed", async () => {
    installChineseOriginalResponse();
    const provider = new NeteaseProvider();
    const result = await provider.fetch(
      candidate,
      track,
      new AbortController().signal,
      { allowOriginalOnly: true },
    );

    expect(result.fidelity).toBe("original-only");
    expect(result.translationCoverage).toBe(0);
    expect(result.lines.map((line) => line.original)).toEqual([
      "让我将你心儿摘下",
      "试着将它慢慢溶化",
    ]);
  });
});

