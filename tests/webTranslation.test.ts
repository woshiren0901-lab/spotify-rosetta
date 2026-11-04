import { describe, expect, it } from "vitest";
import {
  WebTranslationProvider,
  parseBilingualArticle,
  parseLyricsTranslateOriginal,
  parseLyricsTranslateTranslationOnly,
  parseWebTranslationPage,
} from "../src/providers/webTranslation";
import type { TrackInfo } from "../src/types";

const billyTrack: TrackInfo = {
  id: "web-track-1",
  uri: "spotify:track:web-track-1",
  title: "We Didn't Start the Fire",
  artists: ["Billy Joel"],
  album: "Storm Front",
  durationMs: 289_000,
};

describe("web translation sources", () => {
  it("finds the curated human translation for Billy Joel", async () => {
    const provider = new WebTranslationProvider();
    const candidates = await provider.search(
      billyTrack,
      new AbortController().signal,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sourceUrl).toContain("pixnet.net");
    expect(candidates[0]?.sourceLabel).toContain("人工双语");
  });

  it("finds the curated Chinese original for Cui Jian's Last Shot", async () => {
    const provider = new WebTranslationProvider();
    const candidates = await provider.search(
      {
        id: "last-shot",
        uri: "spotify:track:last-shot",
        title: "最后一枪",
        artists: ["崔健"],
        album: "中国风.金曲集",
        durationMs: 259_000,
      },
      new AbortController().signal,
    );
    expect(candidates[0]?.sourceUrl).toContain("cui-jian");
    expect(candidates[0]?.sourceLanguage).toBe("zh");
    expect(candidates[0]?.extra?.parser).toBe("lyricsTranslateOriginal");
  });

  it("parses original-only lyrics from a LyricsTranslate song page", () => {
    const lines = parseLyricsTranslateOriginal(`
      <div id="song-body" class="translate__text" lang="zh-Hans">
        <div class="ltf">
          <div class="par"><div>第一句原文</div><div>第二句原文</div></div>
        </div>
      </div>
    `);
    expect(lines).toEqual([
      { startMs: 0, original: "第一句原文" },
      { startMs: 0, original: "第二句原文" },
    ]);
  });

  it("pairs alternating and mixed bilingual article lines", () => {
    const lines = parseBilingualArticle(`
      <div class="article-content-inner">
        <p>[Verse 1]<br>Harry Truman, Doris Day<br>哈里·杜鲁门、桃乐丝·戴</p>
        <p>We didn't start the fire 不是我们引燃战火</p>
        <p>It was always burning, since the world's been turning</p>
        <p>世界转动时它就一直在燃烧</p>
      </div>
    `);
    expect(lines).toEqual([
      {
        startMs: 0,
        original: "Harry Truman, Doris Day",
        translation: "哈里·杜鲁门、桃乐丝·戴",
      },
      {
        startMs: 0,
        original: "We didn't start the fire",
        translation: "不是我们引燃战火",
      },
      {
        startMs: 0,
        original: "It was always burning, since the world's been turning",
        translation: "世界转动时它就一直在燃烧",
      },
    ]);
  });

  it("extracts translation-only LyricsTranslate pages and drops speaker labels", () => {
    const lines = parseLyricsTranslateTranslationOnly(`
      <div id="translation-body">
        <div class="par">
          <div>Enjolras:</div>
          <div>你可听到人民在歌唱？</div>
          <div>All:</div>
          <div>唱着愤怒者的歌谣</div>
        </div>
      </div>
    `);
    expect(lines.map((line) => line.translation)).toEqual([
      "你可听到人民在歌唱？",
      "唱着愤怒者的歌谣",
    ]);
    expect(
      parseWebTranslationPage(`
        <div id="translation-body"><div>你可听到人民在歌唱？</div></div>
      `),
    ).toHaveLength(1);
  });
});
