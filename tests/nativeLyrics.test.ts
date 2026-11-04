import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeLyricsRenderer } from "../src/dom/nativeLyrics";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import type { ProviderResult } from "../src/types";

function makeResult(overrides: Partial<ProviderResult> = {}): ProviderResult {
  return {
    providerId: "netease",
    candidate: {
      providerId: "netease",
      sourceId: "1",
      title: "Example Song",
      artists: ["Example Artist"],
      album: "Example Album",
      durationMs: 200_000,
      sourceLabel: "网易云音乐",
    },
    matchScore: 0.95,
    translationCoverage: 0.5,
    fidelity: "line",
    lines: [
      {
        startMs: 1_000,
        original: "I can see the light",
        translation: "我能看见光",
      },
      { startMs: 2_000, original: "Another line" },
    ],
    fetchedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  window.Spicetify = undefined;
});

describe("native Spotify lyrics injection", () => {
  it("injects the same translation into both native lyric surfaces", async () => {
    document.body.innerHTML = `
      <div data-testid="lyrics-npv-section"><div>I can see the light</div></div>
      <div data-testid="fullscreen-lyric"><div>I can see the light</div></div>
    `;
    const renderer = new NativeLyricsRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult(),
      statusText: "部分翻译 50% · 网易云音乐",
    });
    await Promise.resolve();
    await Promise.resolve();

    const translations = [
      ...document.querySelectorAll(".rosetta-translation-line"),
    ];
    expect(translations).toHaveLength(2);
    expect(translations.map((node) => node.textContent)).toEqual([
      "我能看见光",
      "我能看见光",
    ]);
    expect(document.querySelectorAll(".rosetta-status-badge")).toHaveLength(2);
    renderer.dispose();
  });

  it("never injects translation into matching track-title text outside lyrics surfaces", async () => {
    document.body.innerHTML = `
      <aside>
        <a href="/track/example">Same lyric line</a>
        <div data-testid="lyrics-npv-section">
          <div>Same lyric line</div>
        </div>
      </aside>
    `;
    const renderer = new NativeLyricsRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult({
        fidelity: "line",
        translationCoverage: 1,
        lines: [
          {
            startMs: 1_000,
            original: "Same lyric line",
            translation: "同一句歌词译文",
          },
        ],
      }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelectorAll(".rosetta-translation-line")).toHaveLength(
      1,
    );
    expect(
      document.querySelector('a[href="/track/example"] .rosetta-translation-line'),
    ).toBeNull();
    expect(
      document.querySelector(
        '[data-testid="lyrics-npv-section"] .rosetta-translation-line',
      )?.textContent,
    ).toBe("同一句歌词译文");
    renderer.dispose();
  });

  it("seeks the corresponding timestamp when a translated line is clicked", async () => {
    document.body.innerHTML = `
      <div data-testid="lyrics-npv-section">
        <div>Seekable lyric</div>
        <div>Second seekable lyric</div>
      </div>
    `;
    const seek = vi.fn();
    window.Spicetify = { Player: { seek } } as never;
    const renderer = new NativeLyricsRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult({
        fidelity: "line",
        translationCoverage: 1,
        lines: [
          {
            startMs: 12_345,
            original: "Seekable lyric",
            translation: "可跳转译文",
          },
          {
            startMs: 23_456,
            original: "Second seekable lyric",
            translation: "第二句可跳转译文",
          },
        ],
      }),
    });
    await Promise.resolve();
    await Promise.resolve();

    const translations = [
      ...document.querySelectorAll<HTMLElement>(".rosetta-translation-line"),
    ];
    expect(translations).toHaveLength(2);
    translations[1]?.click();
    expect(seek).toHaveBeenCalledWith(23_456);
    renderer.dispose();
  });

  it("does not make synthetic plain-text timestamps seekable", async () => {
    document.body.innerHTML = `
      <div data-testid="lyrics-npv-section">
        <div>Untimed lyric</div>
        <div>Another untimed lyric</div>
      </div>
    `;
    const seek = vi.fn();
    window.Spicetify = { Player: { seek } } as never;
    const renderer = new NativeLyricsRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult({
        fidelity: "line",
        translationCoverage: 1,
        lines: [
          {
            startMs: 0,
            original: "Untimed lyric",
            translation: "非同步译文一",
          },
          {
            startMs: 1_000,
            original: "Another untimed lyric",
            translation: "非同步译文二",
          },
        ],
      }),
    });
    await Promise.resolve();
    await Promise.resolve();

    const translation =
      document.querySelector<HTMLElement>(".rosetta-translation-line");
    expect(translation?.classList.contains("is-seekable")).toBe(false);
    expect(translation?.hasAttribute("role")).toBe(false);
    translation?.click();
    expect(seek).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it("uses a labeled third-party block when Spotify has no native lyrics", async () => {
    document.body.innerHTML = `
      <div data-testid="lyrics-npv-section">暂无歌词</div>
    `;
    const renderer = new NativeLyricsRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult({
        lines: [
          {
            startMs: 1,
            original: "Provider original",
            translation: "平台译文",
          },
        ],
        translationCoverage: 1,
      }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      document.querySelector(".rosetta-third-party-lyrics")?.textContent,
    ).toContain("第三方同源歌词");
    renderer.dispose();
  });

  it("shows an existing original in an empty native surface without inventing a translation", async () => {
    document.body.innerHTML = `
      <div data-testid="lyrics-npv-section">暂无歌词</div>
    `;
    const renderer = new NativeLyricsRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult({
        fidelity: "original-only",
        translationCoverage: 0,
        lines: [
          {
            startMs: 35_149,
            original: "让我将你心儿摘下",
          },
        ],
      }),
      statusText: "现成原文歌词 · 网易云音乐",
    });
    await Promise.resolve();
    await Promise.resolve();

    const block = document.querySelector(".rosetta-third-party-lyrics");
    expect(block?.textContent).toContain("第三方同源原文");
    expect(block?.textContent).toContain("让我将你心儿摘下");
    expect(block?.querySelector(".rosetta-third-party-translation")).toBeNull();
    renderer.dispose();
  });

  it("updates word-level translation opacity without replacing the span", async () => {
    document.body.innerHTML = `
      <div data-testid="lyrics-npv-section"><div>Word timed line</div></div>
    `;
    const renderer = new NativeLyricsRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult({
        fidelity: "word",
        translationCoverage: 1,
        lines: [
          {
            startMs: 1_000,
            original: "Word timed line",
            translation: "逐字译文",
            translationSegments: [
              { startMs: 1_000, endMs: 1_500, text: "逐字" },
              { startMs: 1_500, endMs: 2_000, text: "译文" },
            ],
          },
        ],
      }),
    });
    await Promise.resolve();
    await Promise.resolve();
    const segments = [
      ...document.querySelectorAll<HTMLElement>(".rosetta-translation-segment"),
    ];
    expect(segments).toHaveLength(2);
    renderer.setProgress(1_750);
    expect(segments[0]?.style.getPropertyValue("--rosetta-alpha")).toBe("1");
    expect(
      Number(segments[1]?.style.getPropertyValue("--rosetta-alpha")),
    ).toBeGreaterThan(0.32);
    renderer.dispose();
  });

  it("matches a native merged line split across consecutive provider lines", async () => {
    document.body.innerHTML = `
      <div data-testid="fullscreen-lyric">
        <div>何を聞かれても のらりくらり</div>
      </div>
    `;
    const renderer = new NativeLyricsRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult({
        translationCoverage: 1,
        lines: [
          {
            startMs: 25_947,
            original: "何を聞かれても",
            translation: "无论被问到什么",
          },
          {
            startMs: 27_368,
            original: "のらりくらり",
            translation: "都蒙混过关",
          },
        ],
      }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      document.querySelector(".rosetta-translation-line")?.textContent,
    ).toBe("无论被问到什么 都蒙混过关");
    renderer.dispose();
  });

  it("fuzzy-matches lyric variants without crossing short lines", async () => {
    document.body.innerHTML = `
      <div data-testid="fullscreen-lyric">
        <div>愛おしい 橫顔</div>
        <div>青に La, La, Lu, La, La, Lu 染まる 戀し繭玉</div>
        <div>(揚羽の蝶になる)</div>
        <div>悲しみを 寫さずに</div>
        <div>嘆かずに 飛んでみる</div>
      </div>
    `;
    const renderer = new NativeLyricsRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult({
        translationCoverage: 1,
        lines: [
          { startMs: 1, original: "愛おしい横顔", translation: "可爱的侧脸" },
          { startMs: 2, original: "青に", translation: "在青色之中" },
          {
            startMs: 3,
            original: "La La Lu La La Lu",
            translation: "La La Lu La La Lu",
          },
          {
            startMs: 4,
            original: "染まる恋し繭玉",
            translation: "染上恋恋的茧珠",
          },
          {
            startMs: 5,
            original: "揚羽の蝶に",
            translation: "飞翔的蝴蝶",
          },
          {
            startMs: 6,
            original: "悲しみを写さずに",
            translation: "不映照悲伤",
          },
          {
            startMs: 7,
            original: "嘆かず飛んでみる",
            translation: "不叹息，试着飞翔",
          },
        ],
      }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      [...document.querySelectorAll(".rosetta-translation-line")].map(
        (node) => node.textContent,
      ),
    ).toEqual([
      "可爱的侧脸",
      "在青色之中 La La Lu La La Lu 染上恋恋的茧珠",
      "飞翔的蝴蝶",
      "不映照悲伤",
      "不叹息，试着飞翔",
    ]);
    renderer.dispose();
  });

  it("uses the Spotify native sequence to align provider variants", async () => {
    document.body.innerHTML = `
      <div data-testid="fullscreen-lyric">
        <div>青に La, La, Lu, La, La, Lu 染まる 戀し繭玉</div>
      </div>
    `;
    const renderer = new NativeLyricsRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      nativeLines: [
        {
          startMs: 70_000,
          original: "青に La, La, Lu, La, La, Lu 染まる 戀し繭玉",
        },
      ],
      result: makeResult({
        translationCoverage: 1,
        lines: [
          { startMs: 70_000, original: "青に", translation: "在青色之中" },
          {
            startMs: 75_830,
            original: "La La Lu La La Lu",
            translation: "La La Lu La La Lu",
          },
          {
            startMs: 82_700,
            original: "染まる恋し繭玉",
            translation: "染上恋恋的茧珠",
          },
        ],
      }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      document.querySelector(".rosetta-translation-line")?.textContent,
    ).toBe("在青色之中 La La Lu La La Lu 染上恋恋的茧珠");
    renderer.dispose();
  });
});

