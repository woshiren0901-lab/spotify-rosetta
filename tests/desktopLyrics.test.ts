import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import {
  DesktopLyricsRenderer,
  buildDesktopLyricsRows,
  buildNativeDesktopLyricsFrame,
} from "../src/dom/desktopLyrics";
import type {
  LyricsLine,
  ProviderResult,
  TrackInfo,
} from "../src/types";

const lines: LyricsLine[] = [
  { startMs: 0, original: "Line one", translation: "第一句" },
  { startMs: 8_500, original: "Line two", translation: "第二句" },
  { startMs: 17_200, original: "Line three", translation: "第三句" },
  { startMs: 26_900, original: "Line four", translation: "第四句" },
  { startMs: 38_400, original: "Line five", translation: "第五句" },
];

const track: TrackInfo = {
  id: "track",
  uri: "spotify:track:track",
  title: "Song",
  artists: ["Artist"],
  album: "Album",
  durationMs: 100_000,
};

function result(overrides: Partial<ProviderResult> = {}): ProviderResult {
  return {
    providerId: "netease",
    candidate: {
      providerId: "netease",
      sourceId: "source",
      title: "Song",
      artists: ["Artist"],
      album: "Album",
      durationMs: 100_000,
      sourceLabel: "网易云音乐",
    },
    matchScore: 1,
    translationCoverage: 1,
    fidelity: "line",
    lines,
    fetchedAt: 1,
    ...overrides,
  };
}

function nativeState(overrides: Partial<ProviderResult> = {}) {
  return {
    enabled: true,
    settings: {
      ...DEFAULT_SETTINGS,
      desktopLyricsEnabled: true,
    },
    track,
    result: result(overrides),
  };
}

function helperResponse(url: string): Response {
  if (url.endsWith("/health")) {
    return new Response(
      JSON.stringify({ version: 1, token: "test-token" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  if (url.endsWith("/state") || url.endsWith("/hide")) {
    return new Response(null, { status: 204 });
  }
  return new Response(JSON.stringify({ type: "none" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.Spicetify = undefined;
});

describe("native desktop lyrics", () => {
  it("selects the previous, current and next two lines", () => {
    const rows = buildDesktopLyricsRows(lines, 2);
    expect(rows.map((row) => row.index)).toEqual([1, 2, 3, 4]);
    expect(rows.map((row) => row.active)).toEqual([false, true, false, false]);
  });

  it("builds four native rows with seekable timestamps", () => {
    const frame = buildNativeDesktopLyricsFrame(nativeState(), 20_000);
    expect(frame.visible).toBe(true);
    expect(frame.rows.map((row) => row.original)).toEqual([
      "Line two",
      "Line three",
      "Line four",
      "Line five",
    ]);
    expect(frame.rows[1]).toMatchObject({
      active: true,
      seekable: true,
      startMs: 17_200,
    });
  });

  it("auto-scrolls untimed lyrics without making them seekable", () => {
    const untimed = Array.from({ length: 10 }, (_, index) => ({
      startMs: 0,
      original: `Untimed line ${index + 1}`,
    }));
    const frame = buildNativeDesktopLyricsFrame(
      nativeState({ fidelity: "original-only", lines: untimed }),
      55_000,
    );
    expect(frame.rows[1]).toMatchObject({
      original: "Untimed line 6",
      active: true,
      seekable: false,
      startMs: 0,
    });
    const shifted = buildNativeDesktopLyricsFrame(
      nativeState({ fidelity: "original-only", lines: untimed }),
      55_000,
      -1,
    );
    expect(shifted.rows[1]?.original).toBe("Untimed line 5");
  });

  it("persists per-track display calibration without enabling seek", () => {
    const untimed = Array.from({ length: 6 }, (_, index) => ({
      startMs: 0,
      original: `Calibration line ${index + 1}`,
    }));
    const renderer = new DesktopLyricsRenderer();
    const disabledState = {
      ...nativeState({ fidelity: "original-only", lines: untimed }),
      enabled: false,
    };
    renderer.setState(disabledState);
    expect(renderer.getLineOffset()).toBe(0);
    expect(renderer.adjustLineOffset(2)).toBe(2);
    expect(renderer.getLineOffset()).toBe(2);
    const next = new DesktopLyricsRenderer();
    next.setState(disabledState);
    expect(next.getLineOffset()).toBe(2);
    renderer.dispose();
    next.dispose();
  });

  it("posts the native frame and forwards helper seek events", async () => {
    vi.useFakeTimers();
    const seek = vi.fn();
    window.Spicetify = { Player: { seek } } as never;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/events")) {
          return new Response(
            JSON.stringify({ type: "seek", startMs: 17_200 }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return helperResponse(url);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const renderer = new DesktopLyricsRenderer();
    renderer.setState(nativeState());
    renderer.setProgress(20_000);
    expect(await renderer.setEnabled(true)).toBe(true);
    await vi.advanceTimersByTimeAsync(200);

    const stateBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/state"))
      .map(
        ([, init]) =>
          JSON.parse(String(init?.body)) as {
            visible: boolean;
            rows: Array<{ original: string }>;
          },
      );
    expect(
      stateBodies.some(
        (body) => body.visible && body.rows.length === 4,
      ),
    ).toBe(true);
    expect(seek).toHaveBeenCalledWith(17_200);
    renderer.dispose();
  });

  it("does not contact the native helper while disabled", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const renderer = new DesktopLyricsRenderer();
    renderer.setState({
      enabled: false,
      settings: DEFAULT_SETTINGS,
      track,
      result: result(),
    });
    renderer.setProgress(20_000);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();
    renderer.dispose();
  });
});
