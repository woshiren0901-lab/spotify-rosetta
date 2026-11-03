import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { NowPlayingPanelRenderer } from "../src/dom/nowPlayingPanel";
import type { ProviderResult } from "../src/types";

function makeResult(): ProviderResult {
  return {
    providerId: "web",
    candidate: {
      providerId: "web",
      sourceId: "source",
      title: "Example Song",
      artists: ["Example Artist"],
      album: "Example Album",
      durationMs: 180_000,
      sourceLabel: "网页人工译文",
    },
    matchScore: 1,
    translationCoverage: 1,
    fidelity: "line",
    lines: [
      {
        startMs: 1_000,
        original: "First lyric",
        translation: "第一句译文",
      },
      {
        startMs: 2_000,
        original: "Second lyric",
        translation: "第二句译文",
      },
    ],
    fetchedAt: 1,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe("Now Playing fallback panel", () => {
  it("adds bilingual lyrics when Spotify has no native lyrics section", async () => {
    document.body.innerHTML = `
      <aside data-testid="NPV_Panel_OpenDiv" class="main-nowPlayingView-panel">
        <div class="main-nowPlayingView-contextItemInfo">Track info</div>
        <div class="main-nowPlayingView-section">Artist info</div>
      </aside>
    `;
    const renderer = new NowPlayingPanelRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      track: {
        id: "track",
        uri: "spotify:track:track",
        title: "Example Song",
        artists: ["Example Artist"],
        album: "Example Album",
        durationMs: 180_000,
      },
      result: makeResult(),
      statusText: "逐行翻译 · 网页人工译文",
    });
    await Promise.resolve();
    await Promise.resolve();

    const panel = document.querySelector(".rosetta-now-playing-panel");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("First lyric");
    expect(panel?.textContent).toContain("第一句译文");
    expect(document.querySelectorAll(".rosetta-now-playing-panel")).toHaveLength(1);
    renderer.dispose();
  });

  it("does not duplicate lyrics when native Spotify lyrics exist", async () => {
    document.body.innerHTML = `
      <aside class="main-nowPlayingView-panel">
        <div class="main-nowPlayingView-contextItemInfo">Track info</div>
        <div data-testid="lyrics-npv-section">Actual native lyric line</div>
      </aside>
    `;
    const renderer = new NowPlayingPanelRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult(),
      statusText: "逐行翻译",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector(".rosetta-now-playing-panel")).toBeNull();
    renderer.dispose();
  });

  it("replaces an empty native lyrics surface and highlights the active line", async () => {
    document.body.innerHTML = `
      <aside class="main-nowPlayingView-panel">
        <div class="main-nowPlayingView-contextItemInfo">Track info</div>
        <div data-testid="lyrics-npv-section">暂无歌词</div>
      </aside>
    `;
    const renderer = new NowPlayingPanelRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult(),
      statusText: "逐行翻译",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      document
        .querySelector('[data-testid="lyrics-npv-section"]')
        ?.hasAttribute("data-rosetta-empty-native"),
    ).toBe(true);
    renderer.setProgress(2_500);
    const active = document.querySelector(".rosetta-now-playing-line.is-active");
    expect(active?.textContent).toContain("Second lyric");
    expect(document.querySelectorAll(".rosetta-now-playing-panel")).toHaveLength(1);
    renderer.dispose();
    expect(
      document
        .querySelector('[data-testid="lyrics-npv-section"]')
        ?.hasAttribute("data-rosetta-empty-native"),
    ).toBe(false);
  });

  it("supports the hashed current Spotify Now Playing structure", async () => {
    document.body.innerHTML = `
      <aside id="Desktop_PanelContainer_Id" aria-label="当前播放视图">
        <div data-npv-root="true">
          <div class="panel-header">Header</div>
          <div class="panel-scroll">
            <div class="scroll-content">
              <div class="track-context">
                <div class="title-block">
                  <span><a href="/album/example">Example Song</a></span>
                </div>
                <a href="/artist/example">Example Artist</a>
              </div>
              <div>About artist</div>
              <div>Related music</div>
            </div>
          </div>
        </div>
      </aside>
    `;
    const renderer = new NowPlayingPanelRenderer(document);
    renderer.start();
    renderer.setState({
      enabled: true,
      settings: DEFAULT_SETTINGS,
      result: makeResult(),
      statusText: "逐行翻译",
    });
    await Promise.resolve();
    await Promise.resolve();

    const panel = document.querySelector(".rosetta-now-playing-panel");
    expect(panel?.parentElement?.className).toBe("scroll-content");
    expect(panel?.previousElementSibling?.className).toBe("track-context");
    renderer.dispose();
  });
});
