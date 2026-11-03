import type {
  LyricsLine,
  ProviderCandidate,
  ProviderId,
  ProviderResult,
  TrackInfo,
} from "../types";
import {
  asRecord,
  asString,
  readPath,
  requestJson,
  requestHtml,
} from "../core/http";
import { normalizeLanguage, normalizeText } from "../core/normalize";
import {
  buildProviderResult,
  dedupeProviderCandidates,
  searchTrackVariants,
} from "./common";

const BASE_URL = "https://lyricstranslate.com";
const SUBTITLE_URL = `${BASE_URL}/en/callback/subtitles`;

const BODY_SELECTORS = [
  "#original-lyrics",
  "#translation-body",
  ".translate__text",
  "#song-body",
  ".song-body",
  ".js-lyrics-body",
  "[data-lyrics-container]",
] as const;

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "BLOCKQUOTE",
  "BR",
  "DIV",
  "LI",
  "P",
  "SECTION",
]);

export interface LyricsTranslateSearchHit {
  url: string;
  title: string;
  artist: string;
  language: string;
}

export interface ParsedLyricsTranslatePage {
  originalLines: string[];
  translationLines: string[];
  originalLanguage?: string;
  subtitle?: {
    nid: string;
    youtube: string;
  };
}

export interface TimedTranslation {
  startMs: number;
  endMs?: number;
  text: string;
}

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function parseDocument(html: string): Document | undefined {
  if (typeof DOMParser === "undefined") return undefined;
  try {
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return undefined;
  }
}

function stripTags(value: string): string {
  return cleanText(value.replace(/<[^>]+>/g, " "));
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, BASE_URL).href;
  } catch {
    return value;
  }
}

function isChineseLanguage(value: string): boolean {
  return /chinese|中文|汉语|漢語|漢语|zh(?:-\w+)?|\b(?:chs|cht)\b/i.test(value);
}

function parseSearchWithoutDom(html: string): LyricsTranslateSearchHit[] {
  const hits: LyricsTranslateSearchHit[] = [];
  const chunks = html.split(/<div\s+class="table__trow"\s*>/i).slice(1);
  for (const chunk of chunks) {
    const url = chunk.match(/<a\s+href="([^"]+)"\s+class="title-link"/i)?.[1];
    const title = chunk.match(
      /<span\s+class="title-text">([\s\S]*?)<\/span>/i,
    )?.[1];
    const artist = chunk.match(
      /<span\s+class="block-1-table__author">[\s\S]*?<span\s+class="text">([\s\S]*?)<\/span>/i,
    )?.[1];
    const language = chunk.match(
      /<div\s+class="table__langs">([\s\S]*?)<\/div>/i,
    )?.[1];
    if (!url || !title || !artist || !language) continue;
    hits.push({
      url: absoluteUrl(url),
      title: stripTags(title),
      artist: stripTags(artist),
      language: stripTags(language),
    });
  }
  return hits;
}

export function parseLyricsTranslateSearch(
  html: string,
): LyricsTranslateSearchHit[] {
  const document = parseDocument(html);
  if (!document) return parseSearchWithoutDom(html);

  const hits: LyricsTranslateSearchHit[] = [];
  for (const row of document.querySelectorAll<HTMLElement>(".table__trow")) {
    const link = row.querySelector<HTMLAnchorElement>("a.title-link");
    const title = cleanText(
      row.querySelector(".title-text")?.textContent ?? link?.textContent,
    );
    const artist = cleanText(
      row.querySelector(".block-1-table__author .text")?.textContent,
    );
    const languageNode = row.querySelector(
      ".table__langs, .table-songs__lang, .language",
    );
    const language = cleanText(
      [
        languageNode?.textContent,
        languageNode?.getAttribute("data-language"),
        languageNode?.className,
        ...Array.from(languageNode?.querySelectorAll("*") ?? []).flatMap(
          (element) => [
            element.getAttribute("data-language"),
            element.className,
          ],
        ),
      ]
        .filter(Boolean)
        .join(" "),
    );
    const href = link?.getAttribute("href");
    if (!href || !title || !artist) continue;
    hits.push({
      url: absoluteUrl(href),
      title,
      artist,
      language,
    });
  }
  return hits.length ? hits : parseSearchWithoutDom(html);
}

function textWithBreaks(element: Element): string {
  const output: string[] = [];
  const walk = (node: Node): void => {
    if (node instanceof Text) {
      output.push(node.nodeValue ?? "");
      return;
    }
    if (!(node instanceof Element)) return;

    const tag = node.tagName.toUpperCase();
    if (tag === "BR") {
      output.push("\n");
      return;
    }
    for (const child of node.childNodes) walk(child);
    if (BLOCK_TAGS.has(tag)) output.push("\n");
  };
  walk(element);

  return output
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function nonEmptyLines(value: string): string[] {
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function chineseRatio(value: string): number {
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;
  for (const character of value) {
    if (/\p{Script=Han}/u.test(character)) han += 1;
    else if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) {
      kana += 1;
    } else if (/\p{Script=Hangul}/u.test(character)) hangul += 1;
    else if (/\p{Script=Latin}/u.test(character)) latin += 1;
  }
  const total = han + kana + hangul + latin;
  return total ? han / total : 0;
}

function containsKana(value: string): boolean {
  return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function isTranslationBlock(element: Element): boolean {
  return /(?:^|\s)(?:translation|translated|js-translation)(?:\s|$)/i.test(
    `${element.id} ${element.className} ${
      element.parentElement?.id ?? ""
    } ${element.parentElement?.className ?? ""}`,
  );
}

function isOriginalBlock(element: Element): boolean {
  return /(?:^|\s)(?:original|source)(?:\s|$)/i.test(
    `${element.id} ${element.className} ${
      element.parentElement?.id ?? ""
    } ${element.parentElement?.className ?? ""}`,
  );
}

function uniqueElements(elements: Element[]): Element[] {
  const seen = new Set<Element>();
  return elements.filter((element) => {
    if (seen.has(element)) return false;
    seen.add(element);
    return true;
  });
}

function findLyricsBlocks(document: Document): Element[] {
  for (const selector of BODY_SELECTORS) {
    const blocks = uniqueElements([
      ...document.querySelectorAll<HTMLElement>(selector),
    ]);
    if (blocks.length >= 2) return blocks;
  }
  return [];
}

function findSubtitle(document: Document): ParsedLyricsTranslatePage["subtitle"] {
  const candidate =
    document.querySelector<HTMLElement>(
      '.video-icon-player[nid][youtube][cc="1"], [nid][youtube][cc="1"]',
    ) ??
    document.querySelector<HTMLElement>(".video-icon-player[nid][youtube]");
  const nid = candidate?.getAttribute("nid")?.trim() ?? "";
  const youtube = candidate?.getAttribute("youtube")?.trim() ?? "";
  return nid && youtube ? { nid, youtube } : undefined;
}

export function parseLyricsTranslatePage(
  html: string,
): ParsedLyricsTranslatePage | undefined {
  const document = parseDocument(html);
  if (!document) return undefined;

  const directOriginal = document.querySelector(
    "#original-lyrics, [data-panel=\"original\"] .translate__text",
  );
  const directTranslation = document.querySelector(
    "#translation-body, .translate-node-text, [data-panel=\"translation\"] .translate__text",
  );
  if (directOriginal && directTranslation) {
    const originalLines = nonEmptyLines(textWithBreaks(directOriginal));
    const translationLines = nonEmptyLines(
      textWithBreaks(directTranslation),
    );
    if (originalLines.length && translationLines.length) {
      const originalLanguage = normalizeLanguage(
        directOriginal.getAttribute("lang") ?? "",
      );
      return {
        originalLines,
        translationLines,
        ...(originalLanguage ? { originalLanguage } : {}),
        subtitle: findSubtitle(document),
      };
    }
  }

  const blocks = findLyricsBlocks(document);
  if (blocks.length < 2) return undefined;

  const entries = blocks.map((element) => {
    const text = textWithBreaks(element);
    return {
      element,
      lines: nonEmptyLines(text),
      chineseRatio: chineseRatio(text),
      hasKana: containsKana(text),
    };
  });

  const explicitTranslation = entries.find((entry) =>
    isTranslationBlock(entry.element),
  );
  const explicitOriginal = entries.find((entry) => isOriginalBlock(entry.element));
  const automaticTranslation = entries
    .filter((entry) => !entry.hasKana)
    .sort((left, right) => right.chineseRatio - left.chineseRatio)[0];
  const translation = explicitTranslation ?? automaticTranslation;
  const original =
    explicitOriginal ??
    entries.find(
      (entry) =>
        entry !== translation &&
        !entry.hasKana &&
        entry.chineseRatio < (translation?.chineseRatio ?? 1),
    ) ??
    entries.find((entry) => entry !== translation);

  if (!original?.lines.length || !translation?.lines.length) return undefined;
  if (original === translation) return undefined;
  return {
    originalLines: original.lines,
    translationLines: translation.lines,
    subtitle: findSubtitle(document),
  };
}

function parseTimestamp(value: string): number {
  const match =
    /^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/.exec(value.trim());
  if (!match) return Number.NaN;
  return (
    Number(match[1]) * 3_600_000 +
    Number(match[2]) * 60_000 +
    Number(match[3]) * 1_000 +
    Number(match[4])
  );
}

export function parseWebVtt(value: string): TimedTranslation[] {
  const lines = value.replace(/\r/g, "").split("\n");
  const output: TimedTranslation[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const timing = /^(.+?)\s+-->\s+(.+?)(?:\s+.*)?$/.exec(
      lines[index]?.trim() ?? "",
    );
    if (!timing) continue;

    const startMs = parseTimestamp(timing[1] ?? "");
    const endMs = parseTimestamp(timing[2] ?? "");
    if (!Number.isFinite(startMs)) continue;
    const text: string[] = [];
    index += 1;
    while (index < lines.length && (lines[index]?.trim() ?? "")) {
      const line = (lines[index] ?? "")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (line) text.push(line);
      index += 1;
    }
    if (text.length) {
      output.push({
        startMs,
        endMs: Number.isFinite(endMs) ? endMs : undefined,
        text: text.join(" / "),
      });
    }
  }
  return output;
}

function searchUrl(track: TrackInfo, translationLanguage: number): string {
  const artist = track.artists.length
    ? encodeURIComponent(normalizeText(track.artists.join(" ")))
    : "0";
  const title = encodeURIComponent(normalizeText(track.title));
  return `${BASE_URL}/en/songs/0/${artist}/${title}/0/none/0?order=relevance&tlang=${translationLanguage}`;
}

async function searchVariant(
  track: TrackInfo,
  translationLanguage: number,
  signal: AbortSignal,
): Promise<ProviderCandidate[]> {
  const html = await requestHtml(searchUrl(track, translationLanguage), {
    signal,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en",
    },
  });
  return parseLyricsTranslateSearch(html)
    .filter((hit) => isChineseLanguage(hit.language))
    .map((hit) => ({
      providerId: "lyricstranslate" as const,
      sourceId: new URL(hit.url).pathname,
      title: hit.title,
      artists: [hit.artist],
      album: "",
      durationMs: 0,
      sourceLanguage: normalizeLanguage(
        hit.language.split(/\s*(?:→|->)\s*/)[0],
      ),
      sourceUrl: hit.url,
      sourceLabel: "LyricsTranslate",
      extra: { translationLanguage: "zh" },
    }));
}

async function fetchSubtitle(
  subtitle: NonNullable<ParsedLyricsTranslatePage["subtitle"]>,
  signal: AbortSignal,
): Promise<TimedTranslation[]> {
  const response = await requestJson<unknown>(
    `${SUBTITLE_URL}/${encodeURIComponent(subtitle.nid)}/${encodeURIComponent(
      subtitle.youtube,
    )}`,
    {
      signal,
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
      },
    },
  );
  const record = asRecord(response);
  const webVtt =
    asString(record.webtvv) ||
    asString(record.webvtt) ||
    asString(record.vtt) ||
    asString(readPath(record, ["data", "webtvv"]));
  return webVtt ? parseWebVtt(webVtt) : [];
}

function buildLines(
  parsed: ParsedLyricsTranslatePage,
  subtitles: TimedTranslation[],
): { lines: LyricsLine[]; unsyncedTranslation?: string } {
  if (
    subtitles.length === parsed.originalLines.length &&
    subtitles.every((line) => line.text.trim())
  ) {
    return {
      lines: parsed.originalLines.map((original, index) => ({
        startMs: subtitles[index]?.startMs ?? 0,
        endMs: subtitles[index]?.endMs,
        original,
        translation: subtitles[index]?.text,
      })),
    };
  }

  if (parsed.originalLines.length === parsed.translationLines.length) {
    return {
      lines: parsed.originalLines.map((original, index) => ({
        startMs: 0,
        original,
        translation: parsed.translationLines[index],
      })),
    };
  }

  return {
    lines: parsed.originalLines.map((original) => ({
      startMs: 0,
      original,
    })),
    unsyncedTranslation: parsed.translationLines.join("\n"),
  };
}

export class LyricsTranslateProvider {
  readonly id: ProviderId = "lyricstranslate";
  readonly label = "LyricsTranslate";
  readonly providesTranslations = true;

  async search(
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<ProviderCandidate[]> {
    const variants = searchTrackVariants(track).slice(0, 3);
    const searches = variants.flatMap((variant) =>
      [15, 1_037_116].map((language) =>
        searchVariant(variant, language, signal),
      ),
    );
    const results = await Promise.allSettled(
      searches,
    );
    const direct = dedupeProviderCandidates(
      results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
    );
    if (direct.length) return direct;

    const titleOnlyTracks = [track.title, ...(track.titleAliases ?? [])]
      .filter((title, index, all) => all.indexOf(title) === index)
      .slice(0, 2)
      .map((title) => ({
        ...track,
        title,
        artists: [],
        artistAliases: [],
      }));
    const titleOnlyResults = await Promise.allSettled(
      titleOnlyTracks.flatMap((titleTrack) =>
        [15, 1_037_116].map((language) =>
          searchVariant(titleTrack, language, signal),
        ),
      ),
    );
    return dedupeProviderCandidates(
      titleOnlyResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
    );
  }

  async fetch(
    candidate: ProviderCandidate,
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<ProviderResult> {
    if (!candidate.sourceUrl) {
      throw new Error("LyricsTranslate 候选缺少页面地址。");
    }
    const html = await requestHtml(candidate.sourceUrl, {
      signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
      },
    });
    const parsed = parseLyricsTranslatePage(html);
    if (!parsed) {
      throw new Error("LyricsTranslate 页面没有找到同源双语正文。");
    }
    if (
      candidate.sourceLanguage &&
      parsed.originalLanguage &&
      candidate.sourceLanguage !== parsed.originalLanguage
    ) {
      throw new Error("LyricsTranslate 页面原语言与搜索结果不一致。");
    }
    const subtitles = parsed.subtitle
      ? await fetchSubtitle(parsed.subtitle, signal).catch(() => [])
      : [];
    const built = buildLines(parsed, subtitles);
    return buildProviderResult(
      "lyricstranslate",
      track,
      candidate,
      built.lines,
      built.unsyncedTranslation,
      candidate.sourceUrl,
    );
  }
}
