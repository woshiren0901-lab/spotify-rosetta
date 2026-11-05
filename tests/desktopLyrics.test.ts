import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import {
  DesktopLyricsRenderer,
  buildDesktopLyricsRows,
} from "../src/dom/desktopLyrics";
import type { LyricsLine, ProviderResult } from "../src/types";

const lines: LyricsLine[] = [
  { startMs: 0, original: "Line one", translation: "第一句" },
  { startMs: 8_500, original: "Line two", translation: "第二句" },
  { startMs: 17_200, original: "Line three", translation: "第三句" },
  { startMs: 26_900, original: "Line four", translation: "第四句" },
  { startMs: 38_400, original: "Line five", translation: "第五句" },
];

function result(): ProviderResult {
  return {
    providerId: "netease",
    candidate: {
      providerId: "netease",
      sourceId: "source",
      title: "Song",
      artists: ["Artist"],
      album: "Album",
      durationMs: 180_000,
      sourceLabel: "网易云音乐",
    },
    matchScore: 1,
    translationCoverage: 1,
    fidelity: "line",
    lines,
    fetchedAt: 1,
  };
}

afterEach(() => {
  delete (window as Window & { documentPictureInPicture?: unknown })
    .documentPictureInPicture;
  window.Spicetify = undefined;
});

describe("desktop lyrics", () => {
  it("selects the previous, current and next two lines", () => {
    const rows = buildDesktopLyricsRows(lines, 2);
    expect(rows.map((row) => row.index)).toEqual([1, 2, 3, 4]);
    expect(rows.map((row) => row.active)).toEqual([false, true, false, false]);
    expect(rows.map((row) => row.line?.original)).toEqual([
      "Line two",
      "Line three",
      "Line four",
      "Line five",
    ]);
  });

  it("renders a transparent four-line window and seeks on click", async () => {
    const pipDocument = document.implementation.createHTMLDocument(
      "Desktop lyrics",
    );
    const pipWindow = {
      closed: false,
      document: pipDocument,
      addEventListener: vi.fn(),
      close: vi.fn(),
    } as unknown as Window;
    const requestWindow = vi.fn(async () => pipWindow);
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: { requestWindow },
    });
    const seek = vi.fn();
    window.Spicetify = { Player: { seek } } as never;
    const renderer = new DesktopLyricsRenderer();
    renderer.setState({
      enabled: true,
      settings: {
        ...DEFAULT_SETTINGS,
        desktopLyricsPinned: true,
      },
      track: {
        id: "track",
        uri: "spotify:track:track",
        title: "Song",
        artists: ["Artist"],
        album: "Album",
        durationMs: 180_000,
      },
      result: result(),
    });

    expect(await renderer.setEnabled(true)).toBe(true);
    renderer.setProgress(20_000);

    const rows = [
      ...pipDocument.querySelectorAll<HTMLElement>(
        ".rosetta-desktop-line",
      ),
    ];
    expect(rows).toHaveLength(4);
    expect(rows[1]?.classList.contains("is-active")).toBe(true);
    expect(rows[1]?.textContent).toContain("Line three");
    expect(rows[1]?.textContent).toContain("第三句");
    rows[2]?.click();
    expect(seek).toHaveBeenCalledWith(26_900);
    expect(pipDocument.body.style.background).not.toMatch(/rgba?\(/);
    renderer.dispose();
  });

  it("does not make synthetic plain-text timestamps seekable", async () => {
    const pipDocument = document.implementation.createHTMLDocument(
      "Desktop lyrics",
    );
    const pipWindow = {
      closed: false,
      document: pipDocument,
      addEventListener: vi.fn(),
      close: vi.fn(),
    } as unknown as Window;
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: { requestWindow: vi.fn(async () => pipWindow) },
    });
    const seek = vi.fn();
    window.Spicetify = { Player: { seek } } as never;
    const renderer = new DesktopLyricsRenderer();
    renderer.setState({
      enabled: true,
      settings: {
        ...DEFAULT_SETTINGS,
        desktopLyricsPinned: true,
      },
      track: {
        id: "track",
        uri: "spotify:track:track",
        title: "Song",
        artists: ["Artist"],
        album: "Album",
        durationMs: 180_000,
      },
      result: {
        ...result(),
        fidelity: "line",
        lines: [
          { startMs: 0, original: "Untimed lyric", translation: "译文一" },
          {
            startMs: 1_000,
            original: "Another untimed lyric",
            translation: "译文二",
          },
        ],
      },
    });

    expect(await renderer.setEnabled(true)).toBe(true);
    const rows = [
      ...pipDocument.querySelectorAll<HTMLElement>(
        ".rosetta-desktop-line",
      ),
    ];
    expect(rows.every((row) => !row.classList.contains("is-seekable"))).toBe(
      true,
    );
    rows[0]?.click();
    expect(seek).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it("auto-scrolls untimed lyrics without enabling seeking", async () => {
    const pipDocument = document.implementation.createHTMLDocument(
      "Desktop lyrics",
    );
    const pipWindow = {
      closed: false,
      document: pipDocument,
      addEventListener: vi.fn(),
      close: vi.fn(),
    } as unknown as Window;
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: { requestWindow: vi.fn(async () => pipWindow) },
    });
    const seek = vi.fn();
    window.Spicetify = { Player: { seek } } as never;
    const renderer = new DesktopLyricsRenderer();
    renderer.setState({
      enabled: true,
      settings: {
        ...DEFAULT_SETTINGS,
        desktopLyricsPinned: true,
      },
      track: {
        id: "track",
        uri: "spotify:track:track",
        title: "Song",
        artists: ["Artist"],
        album: "Album",
        durationMs: 100_000,
      },
      result: {
        ...result(),
        fidelity: "original-only",
        lines: Array.from({ length: 10 }, (_, index) => ({
          startMs: 0,
          original: `Untimed line ${index + 1}`,
        })),
      },
    });

    expect(await renderer.setEnabled(true)).toBe(true);
    renderer.setProgress(55_000);
    const rows = [
      ...pipDocument.querySelectorAll<HTMLElement>(
        ".rosetta-desktop-line",
      ),
    ];
    expect(rows[1]?.classList.contains("is-active")).toBe(true);
    expect(rows[1]?.textContent).toContain("Untimed line 6");
    expect(rows.every((row) => !row.classList.contains("is-seekable"))).toBe(
      true,
    );
    rows[1]?.click();
    expect(seek).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it("renders a truly transparent in-page overlay", async () => {
    const renderer = new DesktopLyricsRenderer(undefined, "overlay");
    renderer.setState({
      enabled: true,
      settings: {
        ...DEFAULT_SETTINGS,
        desktopLyricsEnabled: true,
      },
      track: {
        id: "track",
        uri: "spotify:track:track",
        title: "Song",
        artists: ["Artist"],
        album: "Album",
        durationMs: 100_000,
      },
      result: {
        ...result(),
        fidelity: "original-only",
        lines: Array.from({ length: 10 }, (_, index) => ({
          startMs: 0,
          original: `Overlay line ${index + 1}`,
        })),
      },
    });

    expect(await renderer.setEnabled(true)).toBe(true);
    renderer.setProgress(55_000);
    const root = document.querySelector<HTMLElement>(
      "#rosetta-desktop-lyrics",
    );
    expect(root).not.toBeNull();
    expect(root?.style.background).toBe("");
    expect(
      document.querySelector<HTMLStyleElement>(
        "#rosetta-desktop-lyrics-style-overlay",
      )?.textContent,
    ).toContain("background: transparent !important");
    expect(root?.style.pointerEvents).toBe("");
    expect(root?.querySelector(".is-active")?.textContent).toContain(
      "Overlay line 6",
    );
    renderer.dispose();
    expect(document.querySelector("#rosetta-desktop-lyrics")).toBeNull();
  });
});
