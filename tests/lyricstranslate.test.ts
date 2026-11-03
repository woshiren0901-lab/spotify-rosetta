import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCorsProxyUrl } from "../src/core/http";
import {
  LyricsTranslateProvider,
  parseLyricsTranslatePage,
  parseLyricsTranslateSearch,
  parseWebVtt,
} from "../src/providers/lyricstranslate";

const searchHtml = `
  <div class="table__trow">
    <a href="/en/example-chinese.html" class="title-link">
      <span class="title-text">Example Song</span>
    </a>
    <span class="block-1-table__author"><span class="text">Example Artist</span></span>
    <div class="table__langs"><a class="lang-zh" data-language="zh">Japanese → Chinese</a></div>
  </div>
  <div class="table__trow">
    <a href="/en/example-english.html" class="title-link">
      <span class="title-text">Example Song</span>
    </a>
    <span class="block-1-table__author"><span class="text">Example Artist</span></span>
    <div class="table__langs"><a class="lang-en" data-language="en">English</a></div>
  </div>
`;

const lyricsHtml = `
  <div class="translate__block" data-panel="original">
    <div id="original-lyrics" class="translate__text song-node-text" lang="ja">
      <div class="par"><div>Hello world</div><div>Second line</div></div>
    </div>
  </div>
  <div class="translate__block" data-panel="translation">
    <div id="translation-body" class="translate__text translate-node-text" lang="zh-CN">
      <div class="par"><div>你好世界</div><div>第二行</div></div>
    </div>
  </div>
  <span class="video-icon-player" nid="123" youtube="video456" cc="1"></span>
`;

afterEach(() => {
  window.Spicetify = undefined;
  vi.unstubAllGlobals();
});

describe("LyricsTranslate parsing", () => {
  it("parses search rows and exposes translation metadata", () => {
    const results = parseLyricsTranslateSearch(searchHtml);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      url: "https://lyricstranslate.com/en/example-chinese.html",
      title: "Example Song",
      artist: "Example Artist",
      language: expect.stringContaining("Chinese"),
    });
  });

  it("keeps the original and Chinese translation as the same source", () => {
    expect(parseLyricsTranslatePage(lyricsHtml)).toEqual({
      originalLines: ["Hello world", "Second line"],
      translationLines: ["你好世界", "第二行"],
      originalLanguage: "ja",
      subtitle: { nid: "123", youtube: "video456" },
    });
  });

  it("filters search results to Chinese and preserves attribution URL", async () => {
    const fetchMock = vi.fn(async () => new Response(searchHtml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.Spicetify = {
      CosmosAsync: {
        get: async () => searchHtml as never,
        post: async () => {
          throw new Error("unexpected POST");
        },
      },
    };
    const provider = new LyricsTranslateProvider();
    const candidates = await provider.search(
      {
        id: "track1",
        uri: "spotify:track:track1",
        title: "Example Song",
        artists: ["Example Artist"],
        album: "Example Album",
        durationMs: 180_000,
      },
      new AbortController().signal,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sourceUrl).toBe(
      "https://lyricstranslate.com/en/example-chinese.html",
    );
    expect(candidates[0]?.sourceLabel).toBe("LyricsTranslate");
    expect(candidates[0]?.sourceLanguage).toBe("ja");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://cors-proxy.spicetify.app/"),
      expect.any(Object),
    );
  });
});

describe("LyricsTranslate subtitles", () => {
  it("parses WebVTT cues into timed translation lines", () => {
    expect(
      parseWebVtt(
        [
          "WEBVTT",
          "",
          "00:00:01.000 --> 00:00:03.250",
          "<i>你好世界</i>",
          "",
          "00:00:03.250 --> 00:00:05.000",
          "第二行",
        ].join("\n"),
      ),
    ).toEqual([
      { startMs: 1_000, endMs: 3_250, text: "你好世界" },
      { startMs: 3_250, endMs: 5_000, text: "第二行" },
    ]);
  });
});

describe("HTML transport", () => {
  it("builds the Spicetify CORS proxy URL for HTML pages", () => {
    expect(
      buildCorsProxyUrl(
        "https://example.com/page",
        "https://proxy.test/{url}",
      ),
    ).toBe("https://proxy.test/https://example.com/page");
  });
});
