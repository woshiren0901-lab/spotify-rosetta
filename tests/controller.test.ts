import { afterEach, describe, expect, it, vi } from "vitest";
import { RosettaController } from "../src/app/controller";
import { NativeLyricsRenderer } from "../src/dom/nativeLyrics";
import { NowPlayingPanelRenderer } from "../src/dom/nowPlayingPanel";
import type {
  LyricsProvider,
  ProviderCandidate,
  ProviderResult,
  TrackInfo,
} from "../src/types";

const track: TrackInfo = {
  id: "controllerTrack001",
  uri: "spotify:track:controllerTrack001",
  title: "Controller Song",
  artists: ["Controller Artist"],
  album: "Controller Album",
  durationMs: 180_000,
};

function candidate(providerId: LyricsProvider["id"]): ProviderCandidate {
  return {
    providerId,
    sourceId: `${providerId}-1`,
    title: track.title,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    sourceLabel: providerId,
  };
}

function provider(providerId: LyricsProvider["id"]): LyricsProvider {
  return {
    id: providerId,
    label: providerId,
    providesTranslations: true,
    search: vi.fn(async () => [candidate(providerId)]),
    fetch: vi.fn(
      async (): Promise<ProviderResult> => ({
        providerId,
        candidate: candidate(providerId),
        matchScore: 0.95,
        translationCoverage: 1,
        fidelity: "line",
        lines: [
          {
            startMs: 1_000,
            original: "Controller lyric line",
            translation: "控制测试译文",
          },
        ],
        fetchedAt: Date.now(),
      }),
    ),
  };
}

function installPlayerMock(): void {
  const listeners = new Map<string, () => void>();
  window.Spicetify = {
    Player: {
      data: {
        item: {
          uri: track.uri,
          name: track.title,
          artists: track.artists.map((name) => ({ name })),
          album: { name: track.album },
          duration: { milliseconds: track.durationMs },
        },
      },
      addEventListener: (event, callback) => listeners.set(event, callback),
      removeEventListener: (event) => listeners.delete(event),
      getProgress: () => 1_200,
    },
    CosmosAsync: {
      get: async () => {
        throw new Error("Network is not expected in this test.");
      },
      post: async () => {
        throw new Error("Network is not expected in this test.");
      },
    },
    LocalStorage: {
      get: () => null,
      set: () => undefined,
      remove: () => undefined,
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
  window.Spicetify = undefined;
});

describe("Rosetta controller", () => {
  it("searches enabled translation providers and publishes the best result", async () => {
    installPlayerMock();
    document.body.innerHTML = `
      <div data-testid="lyrics-npv-section"><div>Controller lyric line</div></div>
    `;
    const controller = new RosettaController(
      [
        provider("netease"),
        provider("qq"),
        provider("musixmatch"),
        {
          ...provider("spotify"),
          providesTranslations: false,
        },
      ],
      new NativeLyricsRenderer(document),
    );
    controller.start();
    await vi.waitFor(() => {
      expect(controller.getSnapshot().status).toBe("line");
    });
    expect(controller.getSnapshot().result?.providerId).toBe("netease");
    expect(controller.getSnapshot().nativeLines).toHaveLength(1);
    expect(controller.getSnapshot().loading).toBe(false);
    controller.dispose();
    await Promise.resolve();
  });

  it("does not query providers while translation is disabled", async () => {
    installPlayerMock();
    window.Spicetify!.LocalStorage = {
      get: (key) =>
        key === "spotify-rosetta:settings:v1"
          ? JSON.stringify({ enabled: false })
          : null,
      set: () => undefined,
      remove: () => undefined,
    };
    const netease = provider("netease");
    const controller = new RosettaController(
      [netease],
      new NativeLyricsRenderer(document),
    );
    controller.start();
    await Promise.resolve();
    expect(controller.getSnapshot().status).toBe("disabled");
    expect(netease.search).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("rejects a same-title tlyric result whose source lyrics do not match Spotify", async () => {
    installPlayerMock();
    document.body.innerHTML = `
      <div data-testid="lyrics-npv-section"><div>Controller lyric line</div></div>
    `;
    const wrongLyrics = provider("netease");
    vi.mocked(wrongLyrics.fetch).mockResolvedValue({
      providerId: "netease",
      candidate: candidate("netease"),
      matchScore: 0.98,
      translationCoverage: 1,
      fidelity: "line",
      lines: [
        {
          startMs: 1_000,
          original: "A completely different song",
          translation: "完全不同的歌词",
        },
      ],
      fetchedAt: Date.now(),
    });
    const controller = new RosettaController(
      [
        wrongLyrics,
        {
          ...provider("spotify"),
          providesTranslations: false,
        },
      ],
      new NativeLyricsRenderer(document),
    );
    controller.start();
    await vi.waitFor(() => {
      expect(controller.getSnapshot().status).toBe("none");
    });
    expect(controller.getSnapshot().result).toBeUndefined();
    expect(controller.getSnapshot().statusText).toBe(
      "未找到可访问的现成中文翻译",
    );
    expect(
      controller
        .getSnapshot()
        .diagnostics.some((item) => item.message?.includes("原文不匹配")),
    ).toBe(true);
    controller.dispose();
    await Promise.resolve();
  });

  it("keeps foreign originals and existing translations together when Spotify has no lyrics", async () => {
    installPlayerMock();
    document.body.innerHTML = `
      <aside class="main-nowPlayingView-panel">
        <div class="main-nowPlayingView-contextItemInfo">Track info</div>
        <div class="main-nowPlayingView-section">Artist info</div>
      </aside>
    `;
    const translated = provider("netease");
    vi.mocked(translated.fetch).mockResolvedValue({
      providerId: "netease",
      candidate: {
        ...candidate("netease"),
        sourceLabel: "网易云音乐",
      },
      matchScore: 0.98,
      translationCoverage: 1,
      fidelity: "line",
      lines: [
        {
          startMs: 1_000,
          original: "Controller lyric line",
          translation: "控制测试译文",
        },
      ],
      fetchedAt: Date.now(),
    });
    const spotify = {
      ...provider("spotify"),
      providesTranslations: false,
      fetch: vi.fn(async () => {
        throw new Error("Spotify 当前曲目没有原生歌词。");
      }),
    };
    const controller = new RosettaController(
      [translated, spotify],
      new NativeLyricsRenderer(document),
      new NowPlayingPanelRenderer(document),
    );
    controller.start();

    await vi.waitFor(() => {
      expect(controller.getSnapshot().status).toBe("line");
    });
    await vi.waitFor(() => {
      const panel = document.querySelector(
        ".rosetta-now-playing-panel",
      )?.textContent;
      expect(panel).toContain("Controller lyric line");
      expect(panel).toContain("控制测试译文");
    });

    controller.dispose();
    await Promise.resolve();
  });

  it("shows matching provider originals when Spotify has no native lyrics", async () => {
    installPlayerMock();
    document.body.innerHTML = `
      <aside class="main-nowPlayingView-panel">
        <div class="main-nowPlayingView-contextItemInfo">Track info</div>
        <div class="main-nowPlayingView-section">Artist info</div>
      </aside>
    `;
    const originalOnly = provider("netease");
    vi.mocked(originalOnly.fetch).mockResolvedValue({
      providerId: "netease",
      candidate: {
        ...candidate("netease"),
        sourceLabel: "网易云音乐",
      },
      matchScore: 0.98,
      translationCoverage: 0,
      fidelity: "original-only",
      lines: [
        {
          startMs: 35_149,
          original: "控制测试原文",
        },
      ],
      fetchedAt: Date.now(),
    });
    const spotify = {
      ...provider("spotify"),
      providesTranslations: false,
      fetch: vi.fn(async () => {
        throw new Error("Spotify 当前曲目没有原生歌词。");
      }),
    };
    const controller = new RosettaController(
      [originalOnly, spotify],
      new NativeLyricsRenderer(document),
      new NowPlayingPanelRenderer(document),
    );
    controller.start();

    await vi.waitFor(() => {
      expect(controller.getSnapshot().status).toBe("original");
    });
    expect(controller.getSnapshot().result?.providerId).toBe("netease");
    expect(controller.getSnapshot().result?.fidelity).toBe("original-only");
    expect(controller.getSnapshot().statusText).toBe(
      "现成原文歌词 · 网易云音乐",
    );
    await vi.waitFor(() => {
      expect(
        document.querySelector(".rosetta-now-playing-panel")?.textContent,
      ).toContain("控制测试原文");
    });
    expect(originalOnly.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { allowOriginalOnly: true },
    );

    controller.dispose();
    await Promise.resolve();
  });

  it("does not use an original-only result when Spotify lyrics exist", async () => {
    installPlayerMock();
    document.body.innerHTML = `
      <div data-testid="lyrics-npv-section"><div>Controller lyric line</div></div>
    `;
    const originalOnly = provider("netease");
    vi.mocked(originalOnly.fetch).mockResolvedValue({
      providerId: "netease",
      candidate: candidate("netease"),
      matchScore: 0.98,
      translationCoverage: 0,
      fidelity: "original-only",
      lines: [{ startMs: 1_000, original: "Controller lyric line" }],
      fetchedAt: Date.now(),
    });
    const controller = new RosettaController(
      [
        originalOnly,
        {
          ...provider("spotify"),
          providesTranslations: false,
        },
      ],
      new NativeLyricsRenderer(document),
    );
    controller.start();
    await vi.waitFor(() => {
      expect(controller.getSnapshot().status).toBe("none");
    });
    expect(controller.getSnapshot().result).toBeUndefined();
    expect(controller.getSnapshot().statusText).toBe(
      "未找到可访问的现成中文翻译",
    );
    expect(
      controller
        .getSnapshot()
        .diagnostics.some((item) =>
          item.message?.includes("仅找到现成原文"),
        ),
    ).toBe(true);
    controller.dispose();
    await Promise.resolve();
  });

  it("returns only manually searchable candidates and binds them to the searched track", async () => {
    installPlayerMock();
    const usable = provider("netease");
    const unusable = provider("qq");
    vi.mocked(unusable.fetch).mockRejectedValue(
      new Error("QQ lyrics unavailable"),
    );
    const controller = new RosettaController(
      [usable, unusable],
      new NativeLyricsRenderer(document),
      new NowPlayingPanelRenderer(document),
    );

    const results = await controller.manualSearch({
      title: track.title,
      artist: track.artists.join(", "),
      album: track.album,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.providerId).toBe("netease");
    expect(results[0]?.trackId).toBe(track.id);
    expect(results[0]?.result).toBeDefined();
  });

  it("uses exact manual-search metadata without stale aliases or ISRC", async () => {
    installPlayerMock();
    const searched = provider("netease");
    vi.mocked(searched.search).mockResolvedValue([
      {
        ...candidate("netease"),
        title: "青春舞曲2000",
        artists: ["群星"],
        album: "皇后大道東",
      },
    ]);
    const controller = new RosettaController(
      [searched],
      new NativeLyricsRenderer(document),
      new NowPlayingPanelRenderer(document),
    );

    const results = await controller.manualSearch({
      title: "最后一枪",
      artist: "崔健",
      album: "中国风金曲集",
    });

    expect(results).toEqual([]);
    const input = vi.mocked(searched.search).mock.calls[0]?.[0];
    expect(input).toMatchObject({
      title: "最后一枪",
      artists: ["崔健"],
      album: "中国风金曲集",
      titleAliases: [],
      artistAliases: [],
      albumAliases: [],
      languageHints: [],
    });
    expect(input?.isrc).toBeUndefined();
  });

  it("rejects a manual candidate after Spotify switches to another track", async () => {
    installPlayerMock();
    const controller = new RosettaController(
      [provider("netease")],
      new NativeLyricsRenderer(document),
      new NowPlayingPanelRenderer(document),
    );
    const results = await controller.manualSearch({
      title: track.title,
      artist: track.artists.join(", "),
      album: track.album,
    });
    expect(results[0]).toBeDefined();

    Object.assign(window.Spicetify!.Player!.data!, {
      item: {
        uri: "spotify:track:anotherTrack002",
        name: "Another Song",
        artists: [{ name: "Another Artist" }],
        album: { name: "Another Album" },
        duration: { milliseconds: 190_000 },
      },
    });

    await expect(
      controller.applyManualSelection(results[0]!),
    ).rejects.toThrow("歌曲已切换");
  });
});

