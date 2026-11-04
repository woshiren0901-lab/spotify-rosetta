import type {
  LyricsLine,
  ProviderResult,
  RosettaSettings,
  TrackInfo,
} from "../types";
import { injectStyles } from "../ui/styles";

const PANEL_ATTRIBUTE = "data-rosetta-now-playing";
const EMPTY_NATIVE_ATTRIBUTE = "data-rosetta-empty-native";
const CONTROL_ATTRIBUTE = "data-rosetta-control-ui";

const PANEL_SELECTORS = [
  '[data-testid="NPV_Panel_OpenDiv"]',
  "#Desktop_PanelContainer_Id",
  '[data-npv-root="true"]',
  'aside[aria-label*="当前播放"]',
  'aside[aria-label*="Now Playing" i]',
  ".main-nowPlayingView-panel",
  ".main-nowPlayingView-nowPlayingGrid",
] as const;

const NATIVE_LYRICS_SELECTORS = [
  '[data-testid="lyrics-npv-section"]',
  '[data-testid*="lyrics" i]',
] as const;

export interface NowPlayingRendererState {
  enabled: boolean;
  settings: RosettaSettings;
  track?: TrackInfo;
  result?: ProviderResult;
  statusText?: string;
  loading?: boolean;
}

function isVisible(element: Element): boolean {
  if (element.hasAttribute("hidden")) return false;
  const htmlElement = element as HTMLElement;
  const style = window.getComputedStyle?.(htmlElement);
  if (
    htmlElement.style.display === "none" ||
    style?.display === "none" ||
    htmlElement.style.visibility === "hidden" ||
    style?.visibility === "hidden"
  ) {
    return false;
  }
  if (typeof element.getClientRects === "function") {
    const rects = element.getClientRects();
    if (rects.length > 0) return true;
  }
  return element.isConnected;
}

function closestCommonAncestor(
  left: Element,
  right: Element,
  boundary: Element,
): HTMLElement | undefined {
  let ancestor = left.parentElement;
  while (
    ancestor &&
    ancestor !== boundary &&
    !ancestor.contains(right)
  ) {
    ancestor = ancestor.parentElement;
  }
  return ancestor && ancestor !== boundary ? ancestor : undefined;
}

function verticalPlacement(
  block: HTMLElement,
  boundary: HTMLElement,
): { parent: HTMLElement; before: ChildNode | null } | undefined {
  let candidate = block;
  while (candidate.parentElement && candidate.parentElement !== boundary) {
    const parent = candidate.parentElement;
    const style = window.getComputedStyle?.(parent);
    const isHorizontalFlex =
      style?.display?.includes("flex") &&
      (style.flexDirection === "row" ||
        style.flexDirection === "row-reverse");
    if (isHorizontalFlex) {
      candidate = parent;
      continue;
    }
    return {
      parent,
      before: candidate.nextSibling,
    };
  }
  return undefined;
}

function textOfLine(line: LyricsLine): string {
  return (
    line.translation?.trim() ||
    line.translationSegments?.map((segment) => segment.text).join("") ||
    ""
  );
}

function sourceLabel(result: ProviderResult): string {
  return result.candidate.sourceLabel ?? result.providerId;
}

function stateSignature(state: NowPlayingRendererState): string {
  return [
    state.enabled ? "1" : "0",
    state.settings.showNowPlayingFallback ? "1" : "0",
    state.track?.id ?? "",
    state.result?.fetchedAt ?? "",
    state.result?.fidelity ?? "",
    state.loading ? "1" : "0",
    state.statusText ?? "",
  ].join("|");
}

export class NowPlayingPanelRenderer {
  private observer?: MutationObserver;
  private state: NowPlayingRendererState = {
    enabled: true,
    settings: {
      schemaVersion: 1,
      enabled: true,
      showPartial: true,
      showUnsynced: true,
      wordHighlight: true,
      showNowPlayingFallback: true,
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
  private refreshQueued = false;
  private mutating = false;
  private progressMs = 0;
  private activeLine = -1;

  constructor(private readonly root: Document = document) {}

  start(): void {
    if (this.observer) return;
    injectStyles(this.root);
    this.observer = new MutationObserver(() => this.queueRefresh());
    this.observer.observe(this.root.body, {
      childList: true,
      subtree: true,
    });
    this.refresh();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.removePanel();
    this.releaseEmptyNativeSurface();
  }

  setState(state: NowPlayingRendererState): void {
    this.state = state;
    if (!state.enabled || !state.settings.showNowPlayingFallback) {
      this.removePanel();
      this.releaseEmptyNativeSurface();
      return;
    }
    this.queueRefresh();
  }

  setProgress(progressMs: number): void {
    this.progressMs = Math.max(0, progressMs);
    this.updateActiveLine();
  }

  refresh(): void {
    if (
      this.mutating ||
      !this.state.enabled ||
      !this.state.settings.showNowPlayingFallback
    ) {
      return;
    }

    this.mutating = true;
    this.observer?.disconnect();
    try {
      const panel = this.findNowPlayingPanel();
      if (!panel) {
        this.removePanel();
        this.releaseEmptyNativeSurface();
        return;
      }

      const nativeSurface = this.findNativeLyricsSurface(panel);
      const nativeHasLyrics =
        nativeSurface !== undefined && !this.looksLikeEmptyLyrics(nativeSurface);
      if (nativeHasLyrics) {
        this.removePanel();
        if (nativeSurface) nativeSurface.removeAttribute(EMPTY_NATIVE_ATTRIBUTE);
        return;
      }

      if (nativeSurface) {
        nativeSurface.setAttribute(EMPTY_NATIVE_ATTRIBUTE, "true");
      } else {
        this.releaseEmptyNativeSurface();
      }

      const signature = stateSignature(this.state);
      let container = this.root.querySelector<HTMLElement>(
        `[${PANEL_ATTRIBUTE}]`,
      );
      if (container?.dataset.signature !== signature) {
        const next = this.renderPanel();
        if (container) {
          container.replaceWith(next);
        }
        container = next;
      }
      if (!container) return;
      this.placePanel(panel, container);
      this.updateActiveLine();
    } finally {
      this.observer?.observe(this.root.body, {
        childList: true,
        subtree: true,
      });
      this.mutating = false;
    }
  }

  private queueRefresh(): void {
    if (this.refreshQueued || this.mutating) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      this.refresh();
    });
  }

  private findNowPlayingPanel(): HTMLElement | undefined {
    const candidates = new Set<HTMLElement>();
    for (const selector of PANEL_SELECTORS) {
      for (const element of this.root.querySelectorAll<HTMLElement>(selector)) {
        if (isVisible(element)) candidates.add(element);
      }
    }
    return [...candidates].sort(
      (left, right) => right.textContent.length - left.textContent.length,
    )[0];
  }

  private findNativeLyricsSurface(panel: HTMLElement): HTMLElement | undefined {
    const candidates = new Set<HTMLElement>();
    for (const selector of NATIVE_LYRICS_SELECTORS) {
      for (const element of panel.querySelectorAll<HTMLElement>(selector)) {
        if (
          element.closest(`[${PANEL_ATTRIBUTE}]`) ||
          (!isVisible(element) &&
            !element.hasAttribute(EMPTY_NATIVE_ATTRIBUTE))
        ) {
          continue;
        }
        candidates.add(element);
      }
    }
    return [...candidates].sort(
      (left, right) => right.textContent.length - left.textContent.length,
    )[0];
  }

  private looksLikeEmptyLyrics(element: HTMLElement): boolean {
    if (element.querySelector(".rosetta-translation-line")) return false;
    const text = element.textContent?.trim() ?? "";
    const normalized = text.toLocaleLowerCase();
    if (
      normalized.includes("暂无歌词") ||
      normalized.includes("歌词不可用") ||
      normalized.includes("目前无法") ||
      normalized.includes("no lyrics") ||
      normalized.includes("lyrics aren't available") ||
      normalized.includes("lyrics are not available")
    ) {
      return true;
    }
    return text.replace(/歌词预览|显示更多|收起|歌词/gi, "").trim().length < 12;
  }

  private panelPlacement(
    panel: HTMLElement,
  ): { parent: HTMLElement; before: ChildNode | null } {
    const trackInfo = panel.querySelector<HTMLElement>(
      ".main-nowPlayingView-contextItemInfo",
    );
    if (trackInfo?.parentElement) {
      return {
        parent: trackInfo.parentElement,
        before: trackInfo.nextSibling,
      };
    }

    const titleLinks = [
      ...panel.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/track/"], a[href^="/track/"], a[href*="/album/"], a[href^="/album/"]',
      ),
    ].filter((link) => Boolean(link.textContent?.trim()));
    const artistLinks = [
      ...panel.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/artist/"], a[href^="/artist/"]',
      ),
    ].filter((link) => Boolean(link.textContent?.trim()));
    let compactBlock: HTMLElement | undefined;
    let compactTextLength = Number.POSITIVE_INFINITY;
    for (const titleLink of titleLinks) {
      for (const artistLink of artistLinks) {
        const block = closestCommonAncestor(titleLink, artistLink, panel);
        if (!block?.parentElement) continue;
        const textLength = (block.textContent ?? "").replace(/\s+/g, "").length;
        if (textLength >= compactTextLength) continue;
        compactBlock = block;
        compactTextLength = textLength;
      }
    }
    if (compactBlock?.parentElement) {
      const placement = verticalPlacement(compactBlock, panel);
      if (placement) return placement;
    }

    const visual = panel.querySelector<HTMLElement>(
      '[data-testid="minimized-track-visual-enhancement"]',
    );
    if (visual?.parentElement) {
      let block: HTMLElement = visual;
      while (
        block.parentElement &&
        block.parentElement !== panel &&
        !block.parentElement.querySelector(
          ".main-nowPlayingView-coverArtContainer, [data-testid=\"track-visual-enhancement\"]",
        )
      ) {
        block = block.parentElement;
      }
      return { parent: block.parentElement ?? panel, before: block.nextSibling };
    }

    const firstSection = panel.querySelector<HTMLElement>(
      ".main-nowPlayingView-section",
    );
    if (firstSection?.parentElement && !firstSection.matches(`[${PANEL_ATTRIBUTE}]`)) {
      return { parent: firstSection.parentElement, before: firstSection };
    }
    return { parent: panel, before: null };
  }

  private placePanel(panel: HTMLElement, container: HTMLElement): void {
    const placement = this.panelPlacement(panel);
    const alreadyPlaced =
      container.parentElement === placement.parent &&
      (container.nextSibling === placement.before ||
        placement.before === container);
    if (
      !alreadyPlaced
    ) {
      placement.parent.insertBefore(container, placement.before);
    }
  }

  private renderPanel(): HTMLElement {
    const section = this.root.createElement("section");
    section.className =
      "main-nowPlayingView-section rosetta-now-playing-panel";
    section.setAttribute(PANEL_ATTRIBUTE, "true");
    section.setAttribute(CONTROL_ATTRIBUTE, "now-playing");
    section.dataset.signature = stateSignature(this.state);

    const header = this.root.createElement("div");
    header.className = "rosetta-now-playing-header";
    const title = this.root.createElement("div");
    title.className = "rosetta-now-playing-title";
    title.textContent = "Spotify Rosetta";
    const status = this.root.createElement("div");
    status.className = "rosetta-now-playing-status";
    status.textContent = this.state.statusText ?? "";
    header.append(title, status);
    section.appendChild(header);

    const result = this.state.result;
    if (result) {
      const lyrics = this.root.createElement("div");
      lyrics.className = "rosetta-now-playing-lyrics";
      result.lines.forEach((line, index) => {
        const original = line.original.trim();
        const translation = textOfLine(line);
        if (!original && !translation) return;
        const row = this.root.createElement("div");
        row.className = "rosetta-now-playing-line";
        row.dataset.lineIndex = String(index);
        row.dataset.startMs = String(line.startMs);
        if (original) {
          const originalNode = this.root.createElement("div");
          originalNode.className = "rosetta-now-playing-original";
          originalNode.textContent = original;
          row.appendChild(originalNode);
        }
        if (translation) {
          const translationNode = this.root.createElement("div");
          translationNode.className = "rosetta-now-playing-translation";
          translationNode.textContent = translation;
          row.appendChild(translationNode);
        }
        lyrics.appendChild(row);
      });
      if (lyrics.childElementCount) section.appendChild(lyrics);

      if (
        this.state.settings.showUnsynced &&
        result.unsyncedTranslation?.trim()
      ) {
        const unsynced = this.root.createElement("div");
        unsynced.className = "rosetta-now-playing-unsynced";
        unsynced.textContent = result.unsyncedTranslation;
        section.appendChild(unsynced);
      }
    } else {
      const empty = this.root.createElement("div");
      empty.className = "rosetta-now-playing-empty";
      empty.textContent = this.state.loading
        ? "正在查找现成译文…"
        : this.state.statusText ?? "暂无可用歌词";
      section.appendChild(empty);
    }
    return section;
  }

  private updateActiveLine(): void {
    const container = this.root.querySelector<HTMLElement>(
      `[${PANEL_ATTRIBUTE}] .rosetta-now-playing-lyrics`,
    );
    if (!container) return;
    const rows = [
      ...container.querySelectorAll<HTMLElement>(".rosetta-now-playing-line"),
    ];
    let active = -1;
    for (let index = 0; index < rows.length; index += 1) {
      const startMs = Number(rows[index]?.dataset.startMs);
      if (Number.isFinite(startMs) && startMs > 0 && startMs <= this.progressMs) {
        active = index;
      }
    }
    if (active === this.activeLine) return;
    this.activeLine = active;
    rows.forEach((row, index) => {
      row.classList.toggle("is-active", index === active);
    });
    const activeRow = rows[active];
    if (activeRow) {
      const target =
        activeRow.offsetTop - container.clientHeight / 2 + activeRow.offsetHeight / 2;
      container.scrollTo?.({
        top: Math.max(0, target),
        behavior: "smooth",
      });
    }
  }

  private removePanel(): void {
    for (const element of this.root.querySelectorAll<HTMLElement>(
      `[${PANEL_ATTRIBUTE}]`,
    )) {
      element.remove();
    }
    this.activeLine = -1;
  }

  private releaseEmptyNativeSurface(): void {
    for (const element of this.root.querySelectorAll<HTMLElement>(
      `[${EMPTY_NATIVE_ATTRIBUTE}]`,
    )) {
      element.removeAttribute(EMPTY_NATIVE_ATTRIBUTE);
    }
  }
}
