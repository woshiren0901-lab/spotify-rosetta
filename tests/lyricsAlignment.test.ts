import { describe, expect, it } from "vitest";
import {
  alignLyricSequences,
  lyricSourceMatchRatio,
} from "../src/core/alignment";
import type { LyricsLine } from "../src/types";

function line(
  startMs: number,
  original: string,
  translation?: string,
): LyricsLine {
  return { startMs, original, translation };
}

describe("native/provider lyric sequence alignment", () => {
  it("combines provider lines and tolerates variants and inserted particles", () => {
    const aligned = alignLyricSequences(
      [
        line(
          10_000,
          "青に La, La, Lu, La, La, Lu 染まる 戀し繭玉",
        ),
        line(20_000, "(揚羽の蝶になる)"),
        line(30_000, "悲しみを 寫さずに"),
      ],
      [
        line(10_000, "青に", "在青色之中"),
        line(15_000, "La La Lu La La Lu", "La La Lu La La Lu"),
        line(20_000, "染まる恋し繭玉", "染上恋恋的茧珠"),
        line(20_000, "揚羽の蝶に", "飞翔的蝴蝶"),
        line(30_000, "悲しみを写さずに", "不映照悲伤"),
      ],
    );

    expect(aligned.map((entry) => entry.translation)).toEqual([
      "在青色之中 La La Lu La La Lu 染上恋恋的茧珠",
      "飞翔的蝴蝶",
      "不映照悲伤",
    ]);
  });

  it("keeps repeated lines in source order and reuses a split translation", () => {
    const aligned = alignLyricSequences(
      [
        line(1_000, "遠い", undefined),
        line(2_000, "約束を抱いて", undefined),
        line(10_000, "同じ副歌", undefined),
        line(20_000, "同じ副歌", undefined),
      ],
      [
        line(1_000, "遠い約束を抱いて", "拥抱遥远的约定"),
        line(10_000, "同じ副歌", "第一次副歌译法"),
        line(20_000, "同じ副歌", "第二次副歌译法"),
      ],
    );

    expect(aligned).toEqual([
      expect.objectContaining({
        original: "遠い",
        translation: "拥抱遥远的约定",
      }),
      expect.objectContaining({
        original: "約束を抱いて",
        translation: "拥抱遥远的约定",
      }),
      expect.objectContaining({
        original: "同じ副歌",
        translation: "第一次副歌译法",
      }),
      expect.objectContaining({
        original: "同じ副歌",
        translation: "第二次副歌译法",
      }),
    ]);
  });

  it("does not fuzzy-match short lyric fragments", () => {
    const aligned = alignLyricSequences(
      [line(1_000, "La Li")],
      [line(1_000, "La Lu", "错误的短句译文")],
    );
    expect(aligned).toEqual([]);
  });

  it("measures source identity independently of translation coverage", () => {
    const native = [
      line(1_000, "First original line"),
      line(2_000, "Second original line"),
      line(3_000, "Third original line"),
      line(4_000, "Fourth original line"),
    ];
    expect(
      lyricSourceMatchRatio(native, [
        line(1_000, "First original line", "第一行"),
        line(2_000, "Second original line"),
        line(3_000, "Third original line"),
        line(4_000, "Fourth original line"),
      ]),
    ).toBe(1);
    expect(
      lyricSourceMatchRatio(native, [
        line(1_000, "Completely different lyrics", "错误译文"),
      ]),
    ).toBe(0);
  });
});
