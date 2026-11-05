import type {
  LyricsLine,
  ProviderResult,
  RosettaSettings,
  TrackInfo,
} from "../types";
import {
  canSeekLyricLine,
  estimatedLyricLineIndex,
  hasReliableLyricsTimeline,
} from "../core/lyricsTimeline";

export interface DesktopLyricsRendererState {
  enabled: boolean;
  settings: RosettaSettings;
  track?: TrackInfo;
  result?: ProviderResult;
  statusText?: string;
  loading?: boolean;
}

export type DesktopLyricsMode = "overlay" | "pinned";

export interface DesktopLyricsRow {
  offset: -1 | 0 | 1 | 2;
  index?: number;
  line?: LyricsLine;
  active: boolean;
}

function visibleLine(line: LyricsLine): boolean {
  return Boolean(
    line.original.trim() ||
      line.translation?.trim() ||
      line.translationSegments?.some((segment) => segment.text.trim()),
  );
}

function activeLineIndex(lines: LyricsLine[], progressMs: number): number {
  if (!lines.length) return -1;
  let active = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const startMs = lines[index]?.startMs;
    if (typeof startMs === "number" && startMs > 0 && startMs <= progressMs) {
      active = index;
    }
  }
  return active;
}

function displayLineIndex(
  lines: LyricsLine[],
  progressMs: number,
  durationMs: number,
): number {
  if (!lines.length) return -1;
  if (hasReliableLyricsTimeline(lines)) {
    return activeLineIndex(lines, progressMs);
  }
  return estimatedLyricLineIndex(lines.length, progressMs, durationMs);
}

export function buildDesktopLyricsRows(
  lines: LyricsLine[],
  activeIndex: number,
): DesktopLyricsRow[] {
  const offsets: DesktopLyricsRow["offset"][] = [-1, 0, 1, 2];
  return offsets.map((offset) => {
    const index = activeIndex + offset;
    const line = index >= 0 && index < lines.length ? lines[index] : undefined;
    return {
      offset,
      index: line ? index : undefined,
      line,
      active: offset === 0 && Boolean(line),
    };
  });
}

function lineText(line: LyricsLine): string {
  return (
    line.translation?.trim() ||
    line.translationSegments?.map((segment) => segment.text).join("") ||
    ""
  );
}

export class DesktopLyricsRenderer {
  private state: DesktopLyricsRendererState = {
    enabled: true,
    settings: {
      schemaVersion: 1,
      enabled: true,
      showPartial: true,
      showUnsynced: true,
      wordHighlight: true,
      showNowPlayingFallback: true,
      desktopLyricsEnabled: false,
      desktopLyricsPinned: false,
      cacheLimit: 500,
      providers: {
        netease: true,
        qq: true,
        musixmatch: true,
        lyricstranslate: true,
        web: true,
        lrclib: true,
        spotify: true,
        local: true,
      },
    },
  };
  private progressMs = 0;
  private activeLine = -1;
  private window?: Window;
  private root?: HTMLElement;
  private style?: HTMLStyleElement;
  private closingFromCode = false;

  constructor(
    private readonly onClose?: () => void,
    private readonly mode: DesktopLyricsMode = "pinned",
  ) {}

  private isSurfaceEnabled(): boolean {
    return this.mode === "overlay"
      ? this.state.settings.desktopLyricsEnabled
      : this.state.settings.desktopLyricsPinned;
  }

  setState(state: DesktopLyricsRendererState): void {
    const trackChanged = state.track?.id !== this.state.track?.id;
    const resultChanged =
      state.result?.fetchedAt !== this.state.result?.fetchedAt;
    this.state = state;
    if (trackChanged) this.progressMs = 0;
    if (trackChanged || resultChanged) this.activeLine = -1;
    if (!state.enabled || !this.isSurfaceEnabled()) {
      this.close(false);
      return;
    }
    this.render();
  }

  setProgress(progressMs: number): void {
    this.progressMs = Math.max(0, progressMs);
    this.render(false);
  }

  isOpen(): boolean {
    if (this.mode === "overlay") {
      return Boolean(this.root?.isConnected);
    }
    return Boolean(this.window && !this.window.closed && this.root?.isConnected);
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      this.close(false);
      return false;
    }
    return this.open();
  }

  dispose(): void {
    this.close(true);
  }

  private async open(): Promise<boolean> {
    if (this.isOpen()) {
      this.render();
      return true;
    }
    if (this.mode === "overlay") {
      this.attachWindow(window);
      return true;
    }
    const api = window.documentPictureInPicture;
    if (!api?.requestWindow) return false;
    try {
      const pipWindow =
        api.window && !api.window.closed
          ? api.window
          : await api.requestWindow({
              width: 720,
              height: 360,
            });
      this.attachWindow(pipWindow);
      return true;
    } catch {
      return false;
    }
  }

  private attachWindow(pipWindow: Window): void {
    const pinned = this.mode === "pinned";
    this.window = pipWindow;
    this.closingFromCode = false;
    if (pinned) {
      pipWindow.document.title = "Spotify Rosetta 桌面歌词";
      pipWindow.document.documentElement.style.cssText =
        "margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color-scheme:dark;";
    }
    const style = pipWindow.document.createElement("style");
    style.id = `rosetta-desktop-lyrics-style-${this.mode}`;
    style.textContent = `
      ${
        pinned
          ? `
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent !important;
        }
      `
          : ""
      }
      #rosetta-desktop-lyrics {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;
        background: transparent !important;
        color: #fff;
        font-family: ${JSON.stringify(
          getComputedStyle(document.body).fontFamily ||
            "Spotify Mix, Circular, Segoe UI, sans-serif",
        )};
        pointer-events: none;
        ${
          pinned
            ? `
          width: 100%;
          height: 100%;
          padding: 8px 18px;
        `
            : `
          position: fixed;
          left: 50%;
          bottom: 104px;
          z-index: 2147483647;
          width: min(720px, calc(100vw - 40px));
          max-height: calc(100vh - 150px);
          transform: translateX(-50%);
          text-align: center;
        `
        }
      }
      .rosetta-desktop-line {
        padding: 7px 2px;
        color: #fff;
        cursor: default;
        outline: none;
        pointer-events: none;
        text-shadow: 0 2px 10px rgba(0,0,0,.92), 0 0 3px rgba(0,0,0,.88);
      }
      .rosetta-desktop-line.is-seekable {
        cursor: pointer;
        pointer-events: auto;
      }
      .rosetta-desktop-line.is-seekable:hover,
      .rosetta-desktop-line.is-seekable:focus-visible {
        color: #ffb3b8;
      }
      .rosetta-desktop-line.is-blank {
        visibility: hidden;
      }
      .rosetta-desktop-original {
        font-size: 22px;
        font-weight: 760;
        line-height: 1.32;
        letter-spacing: -.02em;
      }
      .rosetta-desktop-translation {
        margin-top: 4px;
        font-size: 14px;
        font-weight: 520;
        line-height: 1.42;
        color: rgba(255,255,255,.78);
      }
      .rosetta-desktop-line.is-active .rosetta-desktop-original,
      .rosetta-desktop-line.is-active .rosetta-desktop-translation {
        color: #ff4056;
      }
    `;
    if (pinned) {
      pipWindow.document.head.replaceChildren(style);
    } else {
      pipWindow.document.head.appendChild(style);
    }
    const root = pipWindow.document.createElement("main");
    root.id = "rosetta-desktop-lyrics";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Spotify Rosetta 透明悬浮歌词");
    if (pinned) {
      pipWindow.document.body.replaceChildren(root);
    } else {
      pipWindow.document.body.appendChild(root);
    }
    this.style = style;
    this.root = root;
    if (pinned) {
      pipWindow.addEventListener(
        "pagehide",
        () => {
          this.window = undefined;
          this.root = undefined;
          this.style = undefined;
          if (!this.closingFromCode) this.onClose?.();
        },
        { once: true },
      );
    }
    this.activeLine = -1;
    this.render(true);
  }

  private render(force = true): void {
    if (
      !this.window ||
      !this.root ||
      !this.state.enabled ||
      !this.isSurfaceEnabled()
    ) {
      return;
    }

    const lines = (this.state.result?.lines ?? []).filter(visibleLine);
    const active = displayLineIndex(
      lines,
      this.progressMs,
      this.state.track?.durationMs ?? 0,
    );
    if (!force && active === this.activeLine && !this.state.loading) return;
    this.activeLine = active;
    this.root.replaceChildren();
    if (!lines.length) return;

    for (const entry of buildDesktopLyricsRows(lines, active)) {
      const row = this.window.document.createElement("div");
      row.className = "rosetta-desktop-line";
      if (!entry.line || entry.index === undefined) {
        row.classList.add("is-blank");
        row.setAttribute("aria-hidden", "true");
        this.root.appendChild(row);
        continue;
      }
      if (entry.active) row.classList.add("is-active");
      if (canSeekLyricLine(this.state.result, entry.line)) {
        row.classList.add("is-seekable");
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.setAttribute(
          "aria-label",
          `跳到歌词：${entry.line.original || lineText(entry.line)}`,
        );
        const seek = () => window.Spicetify?.Player;
        const seekToLine = () => seek()?.seek?.(entry.line?.startMs ?? 0);
        row.addEventListener("click", seekToLine);
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            seekToLine();
          }
        });
      }

      if (entry.line.original.trim()) {
        const original = this.window.document.createElement("div");
        original.className = "rosetta-desktop-original";
        original.textContent = entry.line.original.trim();
        row.appendChild(original);
      }
      const translation = lineText(entry.line);
      if (translation) {
        const copy = this.window.document.createElement("div");
        copy.className = "rosetta-desktop-translation";
        copy.textContent = translation;
        row.appendChild(copy);
      }
      this.root.appendChild(row);
    }
  }

  private close(suppressCallback: boolean): void {
    const pinned = this.mode === "pinned";
    const pipWindow = pinned
      ? this.window ?? window.documentPictureInPicture?.window
      : undefined;
    const root = this.root;
    const style = this.style;
    this.closingFromCode = suppressCallback;
    this.window = undefined;
    this.root = undefined;
    this.style = undefined;
    this.activeLine = -1;
    root?.remove();
    style?.remove();
    if (pinned && pipWindow && !pipWindow.closed) pipWindow.close();
  }
}
