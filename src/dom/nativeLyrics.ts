import type {
  LyricsLine,
  ProviderResult,
  RosettaSettings,
  TranslationSegment,
} from "../types";
import { alignLyricSequences } from "../core/alignment";
import { canSeekLyricLine } from "../core/lyricsTimeline";
import { normalizeLyricText } from "../core/normalize";

const TRANSLATION_ATTRIBUTE = "data-rosetta-translation";
const SURFACE_ATTRIBUTE = "data-rosetta-surface";
const CONTROL_ATTRIBUTE = "data-rosetta-control-ui";

const SURFACE_SELECTORS = [
  '[data-testid="lyrics-npv-section"]',
  '[data-testid="fullscreen-lyric"]',
  '[data-testid*="lyrics" i]',
  '[data-testid*="lyric" i]',
  '[aria-label*="lyrics" i]',
  '[aria-label*="歌词"]',
  '[class*="Lyrics" i]',
  '[class*="lyrics" i]',
] as const;

const EXCLUDED_SELECTORS = [
  '[data-testid="now-playing-bar"]',
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  ".rosetta-modal",
  ".rosetta-controls",
  `[${CONTROL_ATTRIBUTE}]`,
] as const;

export interface NativeRendererState {
  enabled: boolean;
  settings: RosettaSettings;
  result?: ProviderResult;
  nativeLines?: LyricsLine[];
  statusText?: string;
  loading?: boolean;
}

interface SegmentNode {
  element: HTMLSpanElement;
  startMs: number;
  endMs: number;
}

interface TranslationLookup {
  exact: Map<string, LyricsLine>;
  composed: Map<string, LyricsLine>;
  fuzzy: Array<{ key: string; line: LyricsLine }>;
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
  return navigator.userAgent.includes("jsdom") && element.isConnected;
}

function isExcluded(element: Element): boolean {
  return EXCLUDED_SELECTORS.some((selector) => {
    try {
      return Boolean(element.closest(selector));
    } catch {
      return false;
    }
  });
}

function elementForText(
  node: Text,
  key: string,
  boundary: HTMLElement,
): HTMLElement | undefined {
  let candidate: Element | null = node.parentElement;
  let fallback: HTMLElement | undefined;
  for (
    let depth = 0;
    candidate && depth < 6 && boundary.contains(candidate);
    depth += 1
  ) {
    if (candidate instanceof HTMLElement && !isExcluded(candidate)) {
      const normalized = normalizeLyricText(candidate.textContent ?? "");
      if (normalized === key) {
        fallback = candidate;
        if (candidate.childElementCount === 0) return candidate;
      } else if (fallback) {
        break;
      }
    }
    candidate = candidate.parentElement;
  }
  return fallback;
}

function hasTranslation(line: LyricsLine): boolean {
  return Boolean(line.translation?.trim()) || Boolean(line.translationSegments?.length);
}

function translationText(line: LyricsLine): string {
  return (
    line.translation?.trim() ||
    line.translationSegments?.map((segment) => segment.text).join("") ||
    ""
  );
}

function seekTo(startMs: number): void {
  window.Spicetify?.Player?.seek?.(startMs);
}

function combineTranslationLines(lines: LyricsLine[]): LyricsLine | undefined {
  const translated = lines.filter(hasTranslation);
  if (!translated.length) return undefined;

  const allSegmented = translated.every(
    (line) => line.translationSegments?.length,
  );
  return {
    startMs: lines[0]?.startMs ?? 0,
    endMs: lines.at(-1)?.endMs ?? lines.at(-1)?.startMs,
    original: lines.map((line) => line.original).join(" "),
    translation: translated.map(translationText).filter(Boolean).join(" "),
    translationSegments: allSegmented
      ? translated.flatMap((line) => line.translationSegments ?? [])
      : undefined,
  };
}

function buildTranslationLookup(
  result: ProviderResult | undefined,
  settings: RosettaSettings,
  nativeLines?: LyricsLine[],
): TranslationLookup {
  const lookup: TranslationLookup = {
    exact: new Map<string, LyricsLine>(),
    composed: new Map<string, LyricsLine>(),
    fuzzy: [],
  };
  if (!result) return lookup;

  const hasFullCoverage = result.translationCoverage >= 0.999;
  if (nativeLines?.length && (settings.showPartial || hasFullCoverage)) {
    for (const line of alignLyricSequences(nativeLines, result.lines)) {
      const key = normalizeLyricText(line.original);
      if (key && !lookup.exact.has(key)) lookup.exact.set(key, line);
    }
  }

  for (const line of result.lines) {
    if (!hasTranslation(line)) continue;
    if (!settings.showPartial && !hasFullCoverage) continue;
    const key = normalizeLyricText(line.original);
    if (!key) continue;
    if (!lookup.exact.has(key)) lookup.exact.set(key, line);
  }

  for (let start = 0; start < result.lines.length - 1; start += 1) {
    const parts: string[] = [];
    for (
      let end = start;
      end < Math.min(result.lines.length, start + 4);
      end += 1
    ) {
      const line = result.lines[end];
      if (!line) continue;
      const part = normalizeLyricText(line.original);
      if (!part) break;
      parts.push(part);
      if (parts.length < 2) continue;
      const key = parts.join("");
      if (!key || lookup.composed.has(key)) continue;
      const combined = combineTranslationLines(
        result.lines.slice(start, end + 1),
      );
      if (combined) lookup.composed.set(key, combined);
    }
  }

  lookup.fuzzy = [
    ...lookup.exact.entries(),
    ...lookup.composed.entries(),
  ].map(([key, line]) => ({ key, line }));
  return lookup;
}

function levenshteinSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        (previous[rightIndex - 1] ?? 0) +
        (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        substitution,
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index] ?? 0;
    }
  }
  return 1 - (previous[right.length] ?? 0) / Math.max(left.length, right.length);
}

function findTranslationLine(
  lookup: TranslationLookup,
  key: string,
): LyricsLine | undefined {
  const exact = lookup.exact.get(key) ?? lookup.composed.get(key);
  if (exact || key.length < 6) return exact;

  let bestScore = 0;
  let bestLine: LyricsLine | undefined;
  for (const candidate of lookup.fuzzy) {
    const shortest = Math.min(key.length, candidate.key.length);
    const longest = Math.max(key.length, candidate.key.length);
    if (shortest < 5 || shortest / longest < 0.6) continue;
    const score = levenshteinSimilarity(key, candidate.key);
    if (score > bestScore) {
      bestScore = score;
      bestLine = candidate.line;
    }
  }
  return bestScore >= 0.7 ? bestLine : undefined;
}

function createSegmentedTranslation(
  segments: TranslationSegment[],
  wordHighlight: boolean,
): { wrapper: HTMLSpanElement; segmentNodes: SegmentNode[] } {
  const wrapper = document.createElement("span");
  wrapper.className = "rosetta-translation-text";
  wrapper.dataset.wordHighlight = wordHighlight ? "true" : "false";
  const segmentNodes: SegmentNode[] = [];

  for (const segment of segments) {
    const node = document.createElement("span");
    node.className = "rosetta-translation-segment";
    node.textContent = segment.text;
    node.dataset.startMs = String(segment.startMs);
    node.dataset.endMs = String(segment.endMs);
    wrapper.appendChild(node);
    segmentNodes.push({
      element: node,
      startMs: segment.startMs,
      endMs: segment.endMs,
    });
  }
  return { wrapper, segmentNodes };
}

function sourceLabel(result: ProviderResult): string {
  return result.candidate.sourceLabel ?? result.providerId;
}

function statusFor(state: NativeRendererState): string | undefined {
  if (!state.enabled) return "Rosetta 已关闭";
  if (state.loading) return "正在查找现成翻译…";
  if (state.statusText) return state.statusText;
  const result = state.result;
  if (!result) return undefined;
  if (result.fidelity === "original-only") {
    return `现成原文歌词 · ${sourceLabel(result)}`;
  }
  if (result.fidelity === "unsynced") {
    return `非同步译文 · ${sourceLabel(result)}`;
  }
  if (result.translationCoverage < 0.999) {
    return `部分翻译 ${Math.round(result.translationCoverage * 100)}% · ${sourceLabel(result)}`;
  }
  return `${result.fidelity === "word" ? "逐字翻译" : "逐行翻译"} · ${sourceLabel(result)}`;
}

export class NativeLyricsRenderer {
  private observer?: MutationObserver;
  private state: NativeRendererState = {
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
  private refreshQueued = false;
  private mutating = false;
  private segmentNodes: SegmentNode[] = [];
  private progressMs = 0;
  private translationLookup: TranslationLookup = {
    exact: new Map(),
    composed: new Map(),
    fuzzy: [],
  };

  constructor(private readonly root: Document = document) {}

  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(() => this.queueRefresh());
    this.observer.observe(this.root.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.refresh();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.clearInjected();
  }

  setState(state: NativeRendererState): void {
    this.state = state;
    this.translationLookup = buildTranslationLookup(
      state.result,
      state.settings,
      state.nativeLines,
    );
    if (!state.enabled) {
      this.clearInjected();
      return;
    }
    this.queueRefresh();
  }

  setProgress(progressMs: number): void {
    this.progressMs = Math.max(0, progressMs);
    this.updateWordHighlights();
  }

  refresh(): void {
    if (!this.state.enabled || this.mutating) return;
    this.mutating = true;
    this.observer?.disconnect();
    try {
      this.removeStaleTranslations();
      const lookup = this.translationLookup;
      const seenElements = new Set<HTMLElement>();
      this.segmentNodes = [];

      for (const surface of this.findLyricsSurfaces()) {
        let surfaceInjected = 0;
        const walker = this.root.createTreeWalker(
          surface,
          NodeFilter.SHOW_TEXT,
        );
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!(node instanceof Text)) continue;
          const rawText = node.nodeValue?.trim() ?? "";
          if (!rawText || rawText.length > 320) continue;
          const key = normalizeLyricText(rawText);
          if (!key) continue;
          const line = findTranslationLine(lookup, key);
          if (!line) continue;
          const element = elementForText(node, key, surface);
          if (!element || seenElements.has(element)) continue;
          seenElements.add(element);
          this.injectLine(element, line);
          surfaceInjected += 1;
        }

        this.ensureStatus(surface, statusFor(this.state));
        if (surfaceInjected === 0) {
          this.ensureThirdPartyFallback(surface);
        }
        this.ensureUnsyncedBlock(surface);
      }
      this.updateWordHighlights();
    } finally {
      this.observer?.observe(this.root.body, {
        childList: true,
        subtree: true,
        characterData: true,
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

  private injectLine(element: HTMLElement, line: LyricsLine): void {
    const translation = translationText(line);
    if (!translation) return;

    const wrapper = document.createElement("span");
    wrapper.className = "rosetta-translation-line";
    wrapper.setAttribute(TRANSLATION_ATTRIBUTE, line.original);
    wrapper.setAttribute(CONTROL_ATTRIBUTE, "translation");
    wrapper.setAttribute("aria-label", `中文翻译：${translation}`);
    if (canSeekLyricLine(this.state.result, line)) {
      wrapper.classList.add("is-seekable");
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "button");
      wrapper.setAttribute(
        "aria-label",
        `跳到歌词：${line.original}。中文翻译：${translation}`,
      );
      wrapper.addEventListener("click", (event) => {
        event.stopPropagation();
        seekTo(line.startMs);
      });
      wrapper.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          seekTo(line.startMs);
        }
      });
    }

    if (
      this.state.settings.wordHighlight &&
      line.translationSegments?.length
    ) {
      const segmented = createSegmentedTranslation(
        line.translationSegments,
        true,
      );
      wrapper.appendChild(segmented.wrapper);
      this.segmentNodes.push(...segmented.segmentNodes);
    } else {
      const text = document.createElement("span");
      text.className = "rosetta-translation-text";
      text.textContent = translation;
      wrapper.appendChild(text);
    }
    element.appendChild(wrapper);
  }

  private removeStaleTranslations(): void {
    for (const element of this.root.querySelectorAll<HTMLElement>(
      `[${TRANSLATION_ATTRIBUTE}]`,
    )) {
      element.remove();
    }
    for (const element of this.root.querySelectorAll<HTMLElement>(
      ".rosetta-third-party-lyrics",
    )) {
      element.remove();
    }
    for (const element of this.root.querySelectorAll<HTMLElement>(
      ".rosetta-status-badge, .rosetta-unsynced-translation",
    )) {
      element.remove();
    }
  }

  private findLyricsSurfaces(): HTMLElement[] {
    const found = new Set<HTMLElement>();
    for (const selector of SURFACE_SELECTORS) {
      for (const element of this.root.querySelectorAll<HTMLElement>(selector)) {
        if (isExcluded(element) || !isVisible(element)) continue;
        found.add(element);
      }
    }
    const candidates = [...found];
    return candidates.filter(
      (candidate) =>
        !candidates.some(
          (other) => other !== candidate && candidate.contains(other),
        ),
    );
  }

  private ensureStatus(surface: HTMLElement, text: string | undefined): void {
    const existing = surface.querySelector<HTMLElement>(".rosetta-status-badge");
    if (!text) {
      existing?.remove();
      return;
    }
    if (existing) {
      if (existing.textContent !== text) existing.textContent = text;
      return;
    }
    const badge = document.createElement("div");
    badge.className = "rosetta-status-badge";
    badge.setAttribute(CONTROL_ATTRIBUTE, "status");
    badge.textContent = text;
    surface.prepend(badge);
  }

  private ensureUnsyncedBlock(surface: HTMLElement): void {
    const existing = surface.querySelector<HTMLElement>(
      ".rosetta-unsynced-translation",
    );
    const result = this.state.result;
    const shouldShow =
      this.state.settings.showUnsynced &&
      result?.unsyncedTranslation?.trim() &&
      !result.lines.some((line) => line.translation?.trim());
    if (!shouldShow || !result) {
      existing?.remove();
      return;
    }
    if (existing) {
      if (existing.textContent !== result.unsyncedTranslation) {
        existing.textContent = result.unsyncedTranslation ?? "";
      }
      return;
    }
    const block = document.createElement("section");
    block.className = "rosetta-unsynced-translation";
    block.setAttribute(CONTROL_ATTRIBUTE, "unsynced");
    const title = document.createElement("div");
    title.className = "rosetta-unsynced-title";
    title.textContent = `非同步译文 · ${sourceLabel(result)}`;
    const content = document.createElement("div");
    content.className = "rosetta-unsynced-content";
    content.textContent = result.unsyncedTranslation ?? "";
    block.append(title, content);
    surface.appendChild(block);
  }

  private ensureThirdPartyFallback(surface: HTMLElement): void {
    const existing = surface.querySelector<HTMLElement>(
      ".rosetta-third-party-lyrics",
    );
    const result = this.state.result;
    const shouldShow =
      result &&
      result.providerId !== "spotify" &&
      result.lines.length > 0;
    const nativeText = normalizeLyricText(
      surface.cloneNode(true) instanceof HTMLElement
        ? (surface.cloneNode(true) as HTMLElement).textContent ?? ""
        : "",
    );
    const looksEmpty =
      nativeText.length < 30 ||
      nativeText.includes(normalizeLyricText("暂无歌词")) ||
      nativeText.includes(normalizeLyricText("歌词不可用")) ||
      nativeText.includes(normalizeLyricText("no lyrics"));

    if (!shouldShow || !looksEmpty || !result) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const container = document.createElement("div");
    container.className = "rosetta-third-party-lyrics";
    container.setAttribute(CONTROL_ATTRIBUTE, "third-party");
    const header = document.createElement("div");
    header.className = "rosetta-third-party-header";
    header.textContent =
      result.fidelity === "original-only"
        ? `Spotify 无原生歌词 · 第三方同源原文 · ${sourceLabel(result)}`
        : `Spotify 无原生歌词 · 第三方同源歌词 · ${sourceLabel(result)}`;
    container.appendChild(header);

    for (const line of result.lines) {
      const row = document.createElement("div");
      row.className = "rosetta-third-party-line";
      if (canSeekLyricLine(result, line)) {
        row.classList.add("is-seekable");
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.setAttribute(
          "aria-label",
          `跳到歌词：${line.original || translationText(line)}`,
        );
        row.addEventListener("click", () => seekTo(line.startMs));
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            seekTo(line.startMs);
          }
        });
      }
      const original = document.createElement("div");
      original.className = "rosetta-third-party-original";
      original.textContent = line.original;
      row.appendChild(original);
      const translation =
        line.translation?.trim() ||
        line.translationSegments?.map((segment) => segment.text).join("") ||
        "";
      if (translation) {
        const translated = document.createElement("div");
        translated.className = "rosetta-third-party-translation";
        translated.textContent = translation;
        row.appendChild(translated);
      }
      container.appendChild(row);
    }
    surface.appendChild(container);
  }

  private updateWordHighlights(): void {
    if (
      !this.state.enabled ||
      !this.state.settings.wordHighlight ||
      !this.segmentNodes.length
    ) {
      for (const segment of this.segmentNodes) {
        segment.element.style.setProperty("--rosetta-alpha", "1");
      }
      return;
    }

    for (const segment of this.segmentNodes) {
      if (this.progressMs < segment.startMs) {
        segment.element.style.setProperty("--rosetta-alpha", "0.32");
      } else if (this.progressMs >= segment.endMs) {
        segment.element.style.setProperty("--rosetta-alpha", "1");
      } else {
        const ratio =
          (this.progressMs - segment.startMs) /
          Math.max(1, segment.endMs - segment.startMs);
        segment.element.style.setProperty(
          "--rosetta-alpha",
          String(0.32 + ratio * 0.68),
        );
      }
    }
  }

  private clearInjected(): void {
    this.segmentNodes = [];
    this.removeStaleTranslations();
  }
}

