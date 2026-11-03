import type { LyricsLine, ProviderResult } from "../types";
import {
  determineFidelity,
  normalizeLyricText,
} from "./normalize";

function meaningfulLines(lines: LyricsLine[]): LyricsLine[] {
  return lines.filter(
    (line) => normalizeLyricText(line.original).length >= 2,
  );
}

function translationOf(line: LyricsLine): string {
  return (
    line.translation?.trim() ||
    line.translationSegments?.map((segment) => segment.text).join("") ||
    ""
  );
}

export function hydrateTranslationOnlyResult(
  result: ProviderResult,
  nativeLines: LyricsLine[] | undefined,
): ProviderResult {
  if (!nativeLines?.length) return result;
  if (result.lines.some((line) => line.original.trim())) return result;

  const translations = result.lines
    .map(translationOf)
    .filter(Boolean);
  if (!translations.length) return result;
  const native = meaningfulLines(nativeLines);

  if (native.length === translations.length) {
    const lines = native.map((line, index) => ({
      ...line,
      translation: translations[index],
    }));
    return {
      ...result,
      lines,
      unsyncedTranslation: undefined,
      translationCoverage: 1,
      fidelity: determineFidelity(lines),
    };
  }

  return {
    ...result,
    lines: native,
    unsyncedTranslation: translations.join("\n"),
    translationCoverage: 0,
    fidelity: "unsynced",
  };
}
