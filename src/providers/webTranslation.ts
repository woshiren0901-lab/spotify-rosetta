import type {
  LyricsLine,
  ProviderCandidate,
  ProviderId,
  ProviderResult,
  TrackInfo,
} from "../types";
import { requestHtml } from "../core/http";
import { normalizeTitleBase } from "../core/normalize";
import {
  buildProviderResult,
  dedupeProviderCandidates,
} from "./common";

type WebParser = "bilingualArticle" | "lyricsTranslateTranslationOnly";

interface WebTranslationSource {
  title: string;
  artistTokens: string[];
  url: string;
  sourceLabel: string;
  parser: WebParser;
}

const WEB_TRANSLATION_SOURCES: WebTranslationSource[] = [
  {
    title: "Do You Hear the People Sing?",
    artistTokens: ["les miserables", "aaron tveit", "eddie redmayne"],
    url:
      "https://lyricstranslate.com/en/do-you-hear-people-sing-ni-ke-ting-dao-ren-min-zai-ge-c.html",
    sourceLabel: "LyricsTranslate · 人工中文译文",
    parser: "lyricsTranslateTranslationOnly",
  },
  {
    title: "We Didn't Start the Fire",
    artistTokens: ["billy joel"],
    url: "https://tonyliu0936.pixnet.net/blog/posts/14217066080",
    sourceLabel: "蔚藍天空 · PIXNET 人工双语译文",
    parser: "bilingualArticle",
  },
];

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "BLOCKQUOTE",
  "DIV",
  "LI",
  "P",
  "SECTION",
]);

function parseDocument(html: string): Document | undefined {
  if (typeof DOMParser === "undefined") return undefined;
  try {
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return undefined;
  }
}

function textWithBreaks(element: Element): string {
  const output: string[] = [];
  const walk = (node: Node): void => {
    if (node instanceof Text) {
      output.push(node.nodeValue ?? "");
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName.toUpperCase() === "BR") {
      output.push("\n");
      return;
    }
    for (const child of node.childNodes) walk(child);
    if (BLOCK_TAGS.has(node.tagName.toUpperCase())) output.push("\n");
  };
  walk(element);
  return output
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n");
}

function pageLines(element: Element): string[] {
  return textWithBreaks(element)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function hasChinese(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function hasLatin(value: string): boolean {
  return /\p{Script=Latin}/u.test(value);
}

function isSectionLabel(value: string): boolean {
  return (
    /^\[(?:verse|chorus|bridge|intro|outro|pre-chorus)/i.test(value) ||
    /^[（(]?(?:verse|chorus|bridge|intro|outro)[）)]?\s*\d*$/i.test(value)
  );
}

function splitMixedLine(value: string): { original: string; translation: string } | undefined {
  const hanIndex = value.search(/\p{Script=Han}/u);
  if (hanIndex <= 0) return undefined;
  const original = value.slice(0, hanIndex).trim();
  const translation = value.slice(hanIndex).trim();
  if (!hasLatin(original) || !hasChinese(translation)) return undefined;
  return { original, translation };
}

export function parseBilingualArticle(html: string): LyricsLine[] {
  const document = parseDocument(html);
  if (!document) return [];
  const root =
    document.querySelector(
      ".article-content-inner, [itemprop=\"articleBody\"], .article-content, article",
    ) ?? document.body;
  if (!root) return [];

  const lines = pageLines(root);
  const firstVerse = lines.findIndex((line) =>
    /^\[(?:verse|chorus|bridge|intro|outro)/i.test(line),
  );
  const candidateLines = firstVerse >= 0 ? lines.slice(firstVerse) : lines;
  const output: LyricsLine[] = [];
  let pendingOriginal = "";

  for (const line of candidateLines) {
    if (isSectionLabel(line)) {
      pendingOriginal = "";
      continue;
    }
    const mixed = splitMixedLine(line);
    if (mixed) {
      output.push({
        startMs: 0,
        original: mixed.original,
        translation: mixed.translation,
      });
      pendingOriginal = "";
      continue;
    }
    if (hasChinese(line)) {
      if (pendingOriginal) {
        output.push({
          startMs: 0,
          original: pendingOriginal,
          translation: line,
        });
        pendingOriginal = "";
      }
      continue;
    }
    if (hasLatin(line) && line.length >= 3) {
      pendingOriginal = line;
    }
  }
  return output;
}

export function parseLyricsTranslateTranslationOnly(
  html: string,
): LyricsLine[] {
  const document = parseDocument(html);
  const root =
    document?.querySelector("#translation-body, .translate-node-text") ?? null;
  if (!root) return [];
  return pageLines(root)
    .filter((line) => !/^[A-Za-zÀ-ÿ' .-]+:$/.test(line))
    .map((translation) => ({
      startMs: 0,
      original: "",
      translation,
    }));
}

export function parseWebTranslationPage(html: string): LyricsLine[] {
  const document = parseDocument(html);
  if (
    document?.querySelector("#translation-body, .translate-node-text")
  ) {
    return parseLyricsTranslateTranslationOnly(html);
  }
  return parseBilingualArticle(html);
}

function sourceMatchesTrack(
  source: WebTranslationSource,
  track: TrackInfo,
): boolean {
  if (
    normalizeTitleBase(source.title) !== normalizeTitleBase(track.title) &&
    !(track.titleAliases ?? []).some(
      (title) => normalizeTitleBase(title) === normalizeTitleBase(source.title),
    )
  ) {
    return false;
  }
  const artists = [
    ...track.artists,
    ...(track.artistAliases ?? []),
  ]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase();
  return source.artistTokens.some((token) => artists.includes(token));
}

export class WebTranslationProvider {
  readonly id: ProviderId = "web";
  readonly label = "网页双语译文";
  readonly providesTranslations = true;

  async search(
    track: TrackInfo,
    _signal: AbortSignal,
  ): Promise<ProviderCandidate[]> {
    return dedupeProviderCandidates(
      WEB_TRANSLATION_SOURCES.filter((source) =>
        sourceMatchesTrack(source, track),
      ).map((source) => ({
        providerId: "web",
        sourceId: source.url,
        title: track.title,
        artists: track.artists,
        album: track.album,
        durationMs: track.durationMs,
        isrc: track.isrc,
        sourceLanguage: "en",
        sourceUrl: source.url,
        sourceLabel: source.sourceLabel,
        extra: { parser: source.parser },
      })),
    );
  }

  async fetch(
    candidate: ProviderCandidate,
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<ProviderResult> {
    if (!candidate.sourceUrl) {
      throw new Error("网页译文候选缺少 URL。");
    }
    const html = await requestHtml(candidate.sourceUrl, {
      signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const parser = candidate.extra?.parser;
    const lines =
      parser === "lyricsTranslateTranslationOnly"
        ? parseLyricsTranslateTranslationOnly(html)
        : parseBilingualArticle(html);
    if (!lines.some((line) => line.translation?.trim())) {
      throw new Error("网页中没有提取到人工中文译文。");
    }
    return buildProviderResult(
      "web",
      track,
      candidate,
      lines,
      undefined,
      candidate.sourceUrl,
    );
  }
}

export async function fetchWebTranslationFromUrl(
  sourceUrl: string,
  track: TrackInfo,
  signal: AbortSignal,
): Promise<ProviderResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error("网页译文 URL 无效。");
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new Error("网页译文只支持 http/https URL。");
  }
  const html = await requestHtml(parsedUrl.href, {
    signal,
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const lines = parseWebTranslationPage(html);
  if (!lines.some((line) => line.translation?.trim())) {
    throw new Error("网页中没有识别到人工中文译文。");
  }
  const candidate: ProviderCandidate = {
    providerId: "web",
    sourceId: parsedUrl.href,
    title: track.title,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    isrc: track.isrc,
    sourceUrl: parsedUrl.href,
    sourceLabel: `网页人工译文 · ${parsedUrl.hostname}`,
  };
  return buildProviderResult(
    "web",
    track,
    candidate,
    lines,
    undefined,
    parsedUrl.href,
  );
}
