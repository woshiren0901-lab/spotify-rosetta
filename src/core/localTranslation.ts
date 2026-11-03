import type {
  LyricsLine,
  ProviderResult,
  TrackInfo,
} from "../types";
import {
  parseLrc,
  pairTranslations,
  unsyncedTranslationText,
  type TimedText,
} from "./lrc";
import { buildProviderResult } from "../providers/common";

interface LocalParseOptions {
  nativeLines?: LyricsLine[];
  track: TrackInfo;
  sourceName: string;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberFrom(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function jsonLines(value: unknown): LyricsLine[] {
  const input = Array.isArray(value)
    ? value
    : Array.isArray(asObject(value).lines)
      ? (asObject(value).lines as unknown[])
      : [];
  const lines: LyricsLine[] = [];
  for (const raw of input) {
    const line = asObject(raw);
    const original = asText(line.original ?? line.source ?? line.text);
    const translation = asText(line.translation ?? line.translated);
    const startMs =
      numberFrom(line.startMs) ??
      numberFrom(line.start) ??
      (numberFrom(line.time) !== undefined
        ? (numberFrom(line.time) ?? 0) * 1_000
        : 0);
    if (!original && !translation) continue;
    lines.push({
      startMs: Math.max(0, startMs),
      original,
      translation: translation || undefined,
      endMs: numberFrom(line.endMs ?? line.end),
    });
  }
  return lines;
}

function fillOriginalsFromNative(
  lines: LyricsLine[],
  nativeLines: LyricsLine[] | undefined,
): LyricsLine[] {
  if (!nativeLines?.length) return lines;
  return lines.map((line, index) => {
    const sameTime = nativeLines.find(
      (native) => Math.abs(native.startMs - line.startMs) <= 750,
    );
    return {
      ...line,
      original:
        line.original ||
        sameTime?.original ||
        nativeLines[index]?.original ||
        "",
      startMs:
        line.startMs || sameTime?.startMs || nativeLines[index]?.startMs || 0,
    };
  });
}

function looksChinese(value: string): boolean {
  const letters = [...value].filter((character) => /\p{L}/u.test(character));
  if (!letters.length || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) {
    return false;
  }
  const han = letters.filter((character) =>
    /\p{Script=Han}/u.test(character),
  ).length;
  return han / letters.length >= 0.45;
}

function pairBilingualLrc(lines: LyricsLine[]): LyricsLine[] {
  const groups = new Map<number, LyricsLine[]>();
  for (const line of lines) {
    const bucket = groups.get(line.startMs) ?? [];
    bucket.push(line);
    groups.set(line.startMs, bucket);
  }
  if (![...groups.values()].some((group) => group.length >= 2)) return [];

  const paired: LyricsLine[] = [];
  for (const group of [...groups.values()].sort(
    (left, right) => (left[0]?.startMs ?? 0) - (right[0]?.startMs ?? 0),
  )) {
    if (group.length < 2) continue;
    const translated = group.find((line) => looksChinese(line.original));
    const original = group.find((line) => line !== translated) ?? group[0];
    if (!original || !translated) continue;
    paired.push({
      startMs: original.startMs,
      original: original.original,
      translation: translated.original,
    });
  }
  return paired;
}

function pairTranslationOnlyLrc(
  lines: LyricsLine[],
  nativeLines: LyricsLine[] | undefined,
): LyricsLine[] {
  if (!nativeLines?.length) return [];
  const translations: TimedText[] = lines
    .filter((line) => looksChinese(line.original))
    .map((line) => ({ startMs: line.startMs, text: line.original }));
  if (!translations.length) return [];
  return pairTranslations(nativeLines, translations, 900);
}

function pairByOrder(
  translations: string[],
  nativeLines: LyricsLine[] | undefined,
): LyricsLine[] {
  if (!nativeLines?.length || translations.length !== nativeLines.length) {
    return [];
  }
  return nativeLines.map((native, index) => ({
    ...native,
    translation: translations[index],
  }));
}

function buildResult(
  lines: LyricsLine[],
  unsyncedTranslation: string | undefined,
  options: LocalParseOptions,
): ProviderResult {
  return buildProviderResult(
    "local",
    options.track,
    {
      providerId: "local",
      sourceId: `local:${options.track.id}`,
      title: options.track.title,
      artists: options.track.artists,
      album: options.track.album,
      durationMs: options.track.durationMs,
      sourceLabel: `本地导入 · ${options.sourceName}`,
      sourceUrl: /^https?:\/\//i.test(options.sourceName)
        ? options.sourceName
        : undefined,
    },
    lines,
    unsyncedTranslation,
    /^https?:\/\//i.test(options.sourceName)
      ? options.sourceName
      : undefined,
  );
}

export function parseLocalTranslation(
  input: string,
  options: LocalParseOptions,
): ProviderResult {
  const text = input.replace(/\u0000/g, "").trim();
  if (!text) throw new Error("导入内容为空。");

  const looksLikeJson =
    text.startsWith("{") || /^\[\s*(?:\{|"|\[)/.test(text);
  if (looksLikeJson) {
    try {
      let lines = jsonLines(JSON.parse(text));
      lines = fillOriginalsFromNative(lines, options.nativeLines);
      if (!lines.some((line) => line.translation?.trim())) {
        throw new Error("JSON 中没有 translation 字段。");
      }
      lines = lines.filter((line) => line.original && line.translation);
      return buildResult(lines, undefined, options);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("JSON 格式无效。");
      }
      throw error;
    }
  }

  const parsed = parseLrc(text);
  if (parsed.lines.length) {
    const bilingual = pairBilingualLrc(parsed.lines);
    if (bilingual.length) {
      return buildResult(bilingual, undefined, options);
    }

    const translationOnly = pairTranslationOnlyLrc(
      parsed.lines,
      options.nativeLines,
    );
    if (translationOnly.some((line) => line.translation)) {
      return buildResult(translationOnly, undefined, options);
    }

    return buildResult(
      options.nativeLines ?? [],
      unsyncedTranslationText(text),
      options,
    );
  }

  const translationLines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const ordered = pairByOrder(translationLines, options.nativeLines);
  if (ordered.length) {
    return buildResult(ordered, undefined, options);
  }

  return buildResult(
    options.nativeLines ?? [],
    translationLines.join("\n"),
    options,
  );
}
