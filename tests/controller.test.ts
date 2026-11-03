import { afterEach, describe, expect, it, vi } from "vitest";
import { RosettaController } from "../src/app/controller";
import { NativeLyricsRenderer } from "../src/dom/nativeLyrics";
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

  it("does not accept an original-only provider result as a translation", async () => {
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
          item.message?.includes("没有返回同源中文译文"),
        ),
    ).toBe(true);
    controller.dispose();
    await Promise.resolve();
  });
});

