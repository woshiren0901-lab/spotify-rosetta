import type {
  LyricsLine,
  ProviderResult,
  RosettaSettings,
  TrackInfo,
} from "../types";
import {
  canSeekLyricLine,
  estimatedLyricLineIndexForLines,
  hasReliableLyricsTimeline,
} from "../core/lyricsTimeline";

const HELPER_ORIGIN = "http://127.0.0.1:18573";
const OFFSET_STORAGE_KEY = "spotify-rosetta:desktop-offsets:v1";

export interface DesktopLyricsRendererState {
  enabled: boolean;
  settings: RosettaSettings;
  track?: TrackInfo;
  result?: ProviderResult;
  statusText?: string;
  loading?: boolean;
}

export interface DesktopLyricsRow {
  offset: -1 | 0 | 1 | 2;
  index?: number;
  line?: LyricsLine;
  active: boolean;
}

export interface NativeDesktopLyricsRow {
  original: string;
  translation: string;
  active: boolean;
  seekable: boolean;
  startMs: number;
}

export interface NativeDesktopLyricsFrame {
  type: "state";
  visible: boolean;
  rows: NativeDesktopLyricsRow[];
}

interface HelperHealth {
  version: number;
  token: string;
}

interface HelperEvent {
  type?: string;
  startMs?: number;
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
  lineOffset: number,
): number {
  if (!lines.length) return -1;
  if (hasReliableLyricsTimeline(lines)) {
    return activeLineIndex(lines, progressMs);
  }
  return estimatedLyricLineIndexForLines(
    lines,
    progressMs,
    durationMs,
    lineOffset,
  );
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

export function buildNativeDesktopLyricsFrame(
  state: DesktopLyricsRendererState,
  progressMs: number,
  lineOffset = 0,
): NativeDesktopLyricsFrame {
  const result = state.result;
  const lines = (result?.lines ?? []).filter(visibleLine);
  const active = displayLineIndex(
    lines,
    progressMs,
    state.track?.durationMs ?? 0,
    lineOffset,
  );
  const rows = buildDesktopLyricsRows(lines, active)
    .filter(
      (entry): entry is DesktopLyricsRow & {
        line: LyricsLine;
      } => Boolean(entry.line),
    )
    .map((entry) => ({
      original: entry.line.original.trim(),
      translation: lineText(entry.line),
      active: entry.active,
      seekable: canSeekLyricLine(result, entry.line),
      startMs: entry.line.startMs,
    }));

  return {
    type: "state",
    visible:
      state.enabled &&
      state.settings.desktopLyricsEnabled &&
      rows.length > 0,
    rows,
  };
}

export class DesktopLyricsRenderer {
  private state: DesktopLyricsRendererState = {
    enabled: false,
    settings: {
      schemaVersion: 1,
      enabled: true,
      showPartial: true,
      showUnsynced: true,
      wordHighlight: true,
      showNowPlayingFallback: true,
      desktopLyricsEnabled: false,
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
  private lineOffset = 0;
  private token?: string;
  private eventTimer?: number;
  private pollInFlight = false;
  private pushInFlight = false;
  private pushQueued = false;
  private lastPayload = "";
  private failureNotified = false;
  private disposed = false;

  setState(state: DesktopLyricsRendererState): void {
    const trackChanged = state.track?.id !== this.state.track?.id;
    const resultChanged =
      state.result?.fetchedAt !== this.state.result?.fetchedAt;
    this.state = state;
    if (trackChanged) {
      this.progressMs = 0;
      this.activeLine = -1;
      this.lineOffset = this.readLineOffset(state.track?.id);
    }
    if (trackChanged || resultChanged) {
      this.lastPayload = "";
    }

    if (!state.enabled || !state.settings.desktopLyricsEnabled) {
      this.stopEventPolling();
      void this.hide();
      return;
    }

    this.startEventPolling();
    void this.pushState();
  }

  setProgress(progressMs: number): void {
    this.progressMs = Math.max(0, progressMs);
    const lines = (this.state.result?.lines ?? []).filter(visibleLine);
    const active = displayLineIndex(
      lines,
      this.progressMs,
      this.state.track?.durationMs ?? 0,
      this.lineOffset,
    );
    if (active === this.activeLine && !this.pushQueued) return;
    this.activeLine = active;
    void this.pushState();
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      this.stopEventPolling();
      await this.hide();
      return false;
    }
    this.startEventPolling();
    await this.pushState(true);
    return true;
  }

  adjustLineOffset(delta: number): number {
    const trackId = this.state.track?.id;
    if (!trackId) return this.lineOffset;
    this.lineOffset = Math.max(
      -12,
      Math.min(12, this.lineOffset + Math.trunc(delta)),
    );
    const offsets = this.readAllLineOffsets();
    offsets[trackId] = this.lineOffset;
    try {
      window.localStorage?.setItem(OFFSET_STORAGE_KEY, JSON.stringify(offsets));
    } catch {
      // Keep the calibration for the current session.
    }
    this.activeLine = -1;
    this.lastPayload = "";
    void this.pushState(true);
    return this.lineOffset;
  }

  resetLineOffset(): number {
    return this.adjustLineOffset(-this.lineOffset);
  }

  getLineOffset(): number {
    return this.lineOffset;
  }

  dispose(): void {
    this.disposed = true;
    this.stopEventPolling();
    void this.hide();
  }

  private startEventPolling(): void {
    if (this.eventTimer || this.disposed) return;
    this.eventTimer = window.setInterval(() => {
      void this.pollEvents();
    }, 160);
  }

  private stopEventPolling(): void {
    if (!this.eventTimer) return;
    window.clearInterval(this.eventTimer);
    this.eventTimer = undefined;
  }

  private async pollEvents(): Promise<void> {
    if (
      this.disposed ||
      this.pollInFlight ||
      !this.state.enabled ||
      !this.state.settings.desktopLyricsEnabled
    ) {
      return;
    }
    this.pollInFlight = true;
    try {
      const hadToken = Boolean(this.token);
      const token = await this.ensureToken();
      if (!token) return;
      if (!hadToken) {
        void this.pushState(true);
      }
      const response = await fetch(`${HELPER_ORIGIN}/events`, {
        cache: "no-store",
        headers: { "X-Rosetta-Token": token },
      });
      if (response.status === 401) {
        this.token = undefined;
        return;
      }
      if (!response.ok) return;
      const event = (await response.json()) as HelperEvent;
      if (
        event.type === "seek" &&
        typeof event.startMs === "number" &&
        Number.isFinite(event.startMs)
      ) {
        window.Spicetify?.Player?.seek?.(event.startMs);
      }
    } catch {
      this.token = undefined;
    } finally {
      this.pollInFlight = false;
    }
  }

  private async pushState(force = false): Promise<void> {
    if (
      this.disposed ||
      !this.state.enabled ||
      !this.state.settings.desktopLyricsEnabled
    ) {
      return;
    }
    if (this.pushInFlight) {
      this.pushQueued = true;
      return;
    }

    const frame = buildNativeDesktopLyricsFrame(
      this.state,
      this.progressMs,
      this.lineOffset,
    );
    const payload = JSON.stringify(frame);
    if (!force && payload === this.lastPayload) return;

    this.pushInFlight = true;
    try {
      const token = await this.ensureToken();
      if (!token) return;
      const response = await fetch(`${HELPER_ORIGIN}/state`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Rosetta-Token": token,
        },
        body: payload,
      });
      if (response.status === 401) {
        this.token = undefined;
        return;
      }
      if (!response.ok) return;
      this.lastPayload = payload;
      this.failureNotified = false;
    } catch {
      this.token = undefined;
      this.ensureHelper();
    } finally {
      this.pushInFlight = false;
      if (this.pushQueued) {
        this.pushQueued = false;
        void this.pushState();
      }
    }
  }

  private async hide(): Promise<void> {
    if (!this.token) return;
    try {
      await fetch(`${HELPER_ORIGIN}/hide`, {
        method: "POST",
        cache: "no-store",
        headers: { "X-Rosetta-Token": this.token },
      });
    } catch {
      this.token = undefined;
    }
    this.lastPayload = "";
  }

  private async ensureToken(): Promise<string | undefined> {
    if (this.token) return this.token;
    try {
      const response = await fetch(`${HELPER_ORIGIN}/health`, {
        cache: "no-store",
      });
      if (!response.ok) return undefined;
      const health = (await response.json()) as HelperHealth;
      if (!health.token || health.version !== 1) return undefined;
      this.token = health.token;
      return this.token;
    } catch {
      this.ensureHelper();
      return undefined;
    }
  }

  private ensureHelper(): void {
    if (this.disposed) return;
    if (!this.failureNotified) {
      this.failureNotified = true;
      window.Spicetify?.showNotification?.(
        "桌面歌词组件尚未运行，请重新运行安装脚本或重启 Windows。",
        true,
      );
    }
  }

  private readLineOffset(trackId: string | undefined): number {
    if (!trackId) return 0;
    const value = this.readAllLineOffsets()[trackId];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(-12, Math.min(12, Math.trunc(value)))
      : 0;
  }

  private readAllLineOffsets(): Record<string, number> {
    try {
      const parsed = JSON.parse(
        window.localStorage?.getItem(OFFSET_STORAGE_KEY) ?? "{}",
      ) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      const output: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          output[key] = Math.max(-12, Math.min(12, Math.trunc(value)));
        }
      }
      return output;
    } catch {
      return {};
    }
  }
}
