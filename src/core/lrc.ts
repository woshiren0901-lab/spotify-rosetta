import type {
  LyricsLine,
  TranslationSegment,
  WordSegment,
} from "../types";

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET = /\[offset:([+-]?\d+)\]/i;
const METADATA = /^\[(ar|al|ti|by|re|ve|length|offset):.*\]$/i;

export interface TimedText {
  startMs: number;
  text: string;
}

export interface ParsedLrc {
  lines: LyricsLine[];
  offsetMs: number;
  plainText: string;
}

function fractionToMs(fraction?: string): number {
  if (!fraction) return 0;
  if (fraction.length === 1) return Number(fraction) * 100;
  if (fraction.length === 2) return Number(fraction) * 10;
  return Number(fraction.slice(0, 3));
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (match, number: string) =>
      Number(number) <= 0x10ffff ? String.fromCodePoint(Number(number)) : match,
    )
    .replace(/&#x([0-9a-f]+);/gi, (match, number: string) =>
      Number.parseInt(number, 16) <= 0x10ffff
        ? String.fromCodePoint(Number.parseInt(number, 16))
        : match,
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function parseLrc(input: string): ParsedLrc {
  const normalized = input.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  const offsetMatch = normalized.match(OFFSET);
  const offsetMs = offsetMatch?.[1] ? Number(offsetMatch[1]) : 0;
  const timed: TimedText[] = [];
  const plain: string[] = [];

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line || METADATA.test(line)) continue;

    TIMESTAMP.lastIndex = 0;
    const matches = [...line.matchAll(TIMESTAMP)];
    const text = decodeEntities(line.replace(TIMESTAMP, "").trim());
    if (!matches.length) {
      if (text) plain.push(text);
      continue;
    }
    if (!text) continue;

    for (const match of matches) {
      const minutes = Number(match[1] ?? 0);
      const seconds = Number(match[2] ?? 0);
      const millis = fractionToMs(match[3]);
      timed.push({
        startMs: Math.max(0, minutes * 60_000 + seconds * 1_000 + millis + offsetMs),
        text,
      });
    }
  }

  timed.sort((left, right) => left.startMs - right.startMs);
  return {
    lines: timed.map((line) => ({
      startMs: line.startMs,
      original: line.text,
    })),
    offsetMs,
    plainText: plain.join("\n"),
  };
}

export function parseWordTimedLyrics(input: string): LyricsLine[] {
  let source = input.trim();
  if (!source) return [];

  if (source.startsWith("{")) {
    try {
      const parsed = JSON.parse(source) as { lyric?: string };
      if (typeof parsed.lyric === "string") source = parsed.lyric;
    } catch {
      // Keep the original text when the payload is not the expected JSON envelope.
    }
  }

  const output: LyricsLine[] = [];
  for (const rawLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const header = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!header) continue;

    const startMs = Number(header[1]);
    const durationMs = Number(header[2]);
    const body = header[3] ?? "";
    const segments: WordSegment[] = [];
    const timingFirst = /^\s*\(\d+,\d+/.test(body);
    const segmentPattern = timingFirst
      ? /\((\d+),(\d+)(?:,-?\d+)?\)([^()]*)/g
      : /([^()]*)\((\d+),(\d+)(?:,-?\d+)?\)/g;
    let match: RegExpExecArray | null;
    while ((match = segmentPattern.exec(body))) {
      const text = decodeEntities(
        timingFirst ? match[3] ?? "" : match[1] ?? "",
      );
      if (!text) continue;
      const segmentStart = Number(timingFirst ? match[1] : match[2]);
      const segmentDuration = Number(timingFirst ? match[2] : match[3]);
      segments.push({
        startMs: segmentStart,
        endMs: segmentStart + segmentDuration,
        text,
      });
    }

    const original = segments.length
      ? segments.map((segment) => segment.text).join("").trim()
      : body.replace(/\(\d+,\d+(?:,-?\d+)?\)/g, "").trim();
    if (!original) continue;

    output.push({
      startMs,
      endMs: startMs + durationMs,
      original,
      wordSegments: segments.length ? segments : undefined,
    });
  }
  return output;
}

export function pairTranslations(
  originals: LyricsLine[],
  translations: TimedText[],
  toleranceMs = 150,
): LyricsLine[] {
  if (!translations.length) return originals;

  const unused = new Set(translations.map((_, index) => index));
  const paired = originals.map((line) => {
    let bestIndex = -1;
    let bestDifference = Number.POSITIVE_INFINITY;
    for (const index of unused) {
      const translation = translations[index];
      if (!translation) continue;
      const difference = Math.abs(translation.startMs - line.startMs);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0 && bestDifference <= toleranceMs) {
      unused.delete(bestIndex);
      return {
        ...line,
        translation: translations[bestIndex]?.text.trim(),
      };
    }
    return line;
  });

  if (paired.some((line) => line.translation)) return paired;

  if (originals.length === translations.length) {
    const ordered = translations
      .slice()
      .sort((left, right) => left.startMs - right.startMs);
    return originals.map((line, index) => ({
      ...line,
      translation: ordered[index]?.text.trim(),
    }));
  }

  return originals;
}

export function attachWordSegments(
  originals: LyricsLine[],
  wordLines: LyricsLine[],
  toleranceMs = 180,
): LyricsLine[] {
  return originals.map((line) => {
    const match = wordLines
      .map((wordLine) => ({
        wordLine,
        difference: Math.abs(wordLine.startMs - line.startMs),
      }))
      .sort((left, right) => left.difference - right.difference)[0];
    if (!match || match.difference > toleranceMs || !match.wordLine.wordSegments) {
      return line;
    }
    return {
      ...line,
      endMs: line.endMs ?? match.wordLine.endMs,
      wordSegments: match.wordLine.wordSegments,
    };
  });
}

function splitGraphemes(value: string): string[] {
  const Segmenter = Intl.Segmenter;
  if (typeof Segmenter === "function") {
    return [...new Segmenter("zh", { granularity: "grapheme" }).segment(value)]
      .map((part) => part.segment);
  }
  return Array.from(value);
}

export function deriveTranslationSegments(
  translation: string | undefined,
  wordSegments: WordSegment[] | undefined,
): TranslationSegment[] | undefined {
  if (!translation?.trim() || !wordSegments?.length) return undefined;

  const graphemes = splitGraphemes(translation.trim());
  if (!graphemes.length) return undefined;
  const chunks = Math.min(graphemes.length, wordSegments.length);
  const output: TranslationSegment[] = [];
  let cursor = 0;

  for (let index = 0; index < wordSegments.length; index += 1) {
    const segment = wordSegments[index];
    if (!segment) continue;
    const remainingChunks = wordSegments.length - index;
    const remainingGraphemes = graphemes.length - cursor;
    const size = Math.max(
      1,
      Math.ceil(remainingGraphemes / Math.max(1, remainingChunks)),
    );
    const text = graphemes.slice(cursor, cursor + size).join("");
    cursor += size;
    if (!text) continue;
    output.push({
      startMs: segment.startMs,
      endMs: segment.endMs,
      text,
    });
  }
  return output.length === chunks || output.length > 0 ? output : undefined;
}

export function parseTranslationText(input: string): TimedText[] {
  const parsed = parseLrc(input);
  if (parsed.lines.length) {
    return parsed.lines.map((line) => ({
      startMs: line.startMs,
      text: line.original,
    }));
  }

  const plain = input
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => decodeEntities(line.replace(TIMESTAMP, "").trim()))
    .filter(Boolean);
  return plain.map((text, index) => ({
    startMs: index * 1_000,
    text,
  }));
}

export function unsyncedTranslationText(input: string): string {
  return input
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      decodeEntities(line.replace(TIMESTAMP, "").trim()),
    )
    .filter((line) => line && !METADATA.test(line))
    .join("\n");
}

