import type {
  LyricsLine,
  ProviderCandidate,
  ProviderResult,
  SyncFidelity,
  TrackInfo,
} from "../types";

const VERSION_PATTERNS: Array<[RegExp, string]> = [
  [/\blive\b|现场|演唱會|演唱会/g, "live"],
  [/\bremix\b|混音|重混/g, "remix"],
  [/\binstrumental\b|karaoke\b|伴奏|纯音乐/g, "instrumental"],
  [/\bacoustic\b|unplugged\b|不插电/g, "acoustic"],
  [/\bcover\b|翻唱/g, "cover"],
  [/\bdemo\b|小样/g, "demo"],
  [/\bsped\s*up\b|加速/g, "sped-up"],
  [/\bslowed\b|慢速/g, "slowed"],
  [/\bremaster(?:ed)?\b|重制/g, "remaster"],
  [/\bradio\s*edit\b|radio\s*version\b|电台版/g, "radio-edit"],
];

const BRACKETED = /[（(\[【][^）)\]】]*[）)\]】]/g;

const LANGUAGE_LABELS: Array<[string, RegExp]> = [
  ["yue", /cantonese|粵語|粤语|广府话|廣府話/i],
  ["ja", /japanese|日本語|日语|日語/i],
  ["ko", /korean|한국어|韓語|韩语|朝鮮語|朝鲜语/i],
  ["zh", /chinese|mandarin|中文|汉语|漢語|國語|国语|普通话|普通話|华语|華語/i],
  ["en", /english|英文|英语|英語/i],
  ["es", /spanish|español|西班牙语|西班牙語/i],
  ["fr", /french|français|法语|法語/i],
  ["de", /german|deutsch|德语|德語/i],
  ["pt", /portuguese|português|葡萄牙语|葡萄牙語/i],
  ["it", /italian|italiano|意大利语|意大利語/i],
  ["ru", /russian|русский|俄语|俄語/i],
  ["th", /thai|泰语|泰語/i],
  ["vi", /vietnamese|越南语|越南語/i],
  ["id", /indonesian|印尼语|印尼語/i],
];

const LANGUAGE_VERSION_TAG =
  /(?:\b(?:english|japanese|korean|chinese|mandarin|cantonese|spanish|french|german|portuguese|italian|russian|thai|vietnamese|indonesian)\s+(?:ver(?:sion)?\.?|edit|version)\b|(?:英文|英语|英語|日文|日语|日語|韓文|韩文|韓語|韩语|中文|國語|国语|普通话|普通話|粵語|粤语|西班牙语|西班牙語|法语|法語|德语|德語|意大利语|意大利語|葡萄牙语|葡萄牙語|俄语|俄語|泰语|泰語|越南语|越南語)版)/gi;

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&/g, " and ")
    .replace(/[_/\\|]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeLyricText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizeTitleBase(value: string): string {
  return normalizeText(value.replace(BRACKETED, " "))
    .replace(/\b(feat|ft)\b.*$/i, "")
    .replace(/\b(remaster|remastered|explicit)\b/g, "")
    .trim();
}

export function normalizeLanguage(value: string | undefined): string | undefined {
  const text = value?.normalize("NFKC").trim() ?? "";
  if (!text) return undefined;
  const code = text.toLocaleLowerCase();
  if (/^(?:ja|jp|jpn)$/.test(code)) return "ja";
  if (/^(?:ko|kr|kor)$/.test(code)) return "ko";
  if (/^(?:zh|zho|chi|cmn|zh-hans|zh-hant)$/.test(code)) return "zh";
  if (/^(?:yue|zh-yue)$/.test(code)) return "yue";
  if (/^(?:en|eng)$/.test(code)) return "en";
  return LANGUAGE_LABELS.find(([, pattern]) => pattern.test(text))?.[0];
}

export function normalizeIsrc(value: string | undefined): string | undefined {
  const text = value?.normalize("NFKC").trim().toUpperCase() ?? "";
  const match = text
    .replace(/[^A-Z0-9]/g, "")
    .match(/[A-Z]{2}[A-Z0-9]{3}\d{7}/);
  return match?.[0];
}

export function extractLanguageVersions(value: string): Set<string> {
  const languages = new Set<string>();
  LANGUAGE_VERSION_TAG.lastIndex = 0;
  for (const match of value.normalize("NFKC").matchAll(LANGUAGE_VERSION_TAG)) {
    const language = normalizeLanguage(match[0]);
    if (language) languages.add(language);
  }
  return languages;
}

export function inferLyricsLanguage(lines: LyricsLine[]): string | undefined {
  const text = lines
    .map((line) => line.original)
    .join("\n")
    .slice(0, 20_000);
  if (!text.trim()) return undefined;

  let han = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;
  for (const character of text) {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)) kana += 1;
    else if (/\p{Script=Hangul}/u.test(character)) hangul += 1;
    else if (/\p{Script=Han}/u.test(character)) han += 1;
    else if (/\p{Script=Latin}/u.test(character)) latin += 1;
  }

  if (kana >= 3) return "ja";
  if (hangul >= 3) return "ko";
  if (latin >= 12 && latin > han + kana + hangul) return "en";
  return undefined;
}

export function extractVersionTokens(value: string): Set<string> {
  const normalized = normalizeText(value);
  const result = new Set<string>();
  for (const [pattern, tag] of VERSION_PATTERNS) {
    if (pattern.test(normalized)) {
      result.add(tag);
    }
  }
  return result;
}

export function splitArtists(value: string): string[] {
  return value
    .normalize("NFKC")
    .split(/\s*(?:,|&|、|\/|\bfeat\.?\b|\bft\.?\b|\bwith\b)\s*/i)
    .map((artist) => normalizeText(artist))
    .filter(Boolean);
}

export function diceSimilarity(left: string, right: string): number {
  const a = normalizeText(left).replace(/\s+/g, "");
  const b = normalizeText(right).replace(/\s+/g, "");
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const counts = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index += 1) {
    const gram = a.slice(index, index + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }

  let overlap = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const gram = b.slice(index, index + 2);
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      counts.set(gram, count - 1);
      overlap += 1;
    }
  }

  return (2 * overlap) / (a.length + b.length - 2);
}

export function artistSimilarity(
  trackArtists: string[],
  candidateArtists: string[],
): number {
  const trackSet = new Set(trackArtists.flatMap(splitArtists));
  const candidateSet = new Set(candidateArtists.flatMap(splitArtists));
  if (!trackSet.size || !candidateSet.size) return 0;

  let best = 0;
  for (const expected of trackSet) {
    for (const actual of candidateSet) {
      best = Math.max(best, diceSimilarity(expected, actual));
    }
  }
  return best;
}

export function versionCompatibility(
  track: TrackInfo,
  candidate: Pick<ProviderCandidate, "title" | "album">,
): number {
  const expected = extractVersionTokens(`${track.title} ${track.album}`);
  const actual = extractVersionTokens(`${candidate.title} ${candidate.album}`);
  const missingFromCandidate = [...expected].filter((tag) => !actual.has(tag));
  const unexpected = [...actual].filter((tag) => !expected.has(tag));
  if (unexpected.length > 0) {
    return Math.max(0, 1 - 0.65 * unexpected.length);
  }
  if (missingFromCandidate.length > 0) return 0.7;
  return 1;
}

export function translationCoverage(lines: LyricsLine[]): number {
  if (!lines.length) return 0;
  const translated = lines.filter(
    (line) => Boolean(line.translation?.trim()) ||
      Boolean(line.translationSegments?.length),
  ).length;
  return translated / lines.length;
}

export function determineFidelity(
  lines: LyricsLine[],
  unsyncedTranslation?: string,
): SyncFidelity {
  if (
    lines.some(
      (line) => line.translationSegments && line.translationSegments.length > 0,
    )
  ) {
    return "word";
  }
  if (
    lines.some(
      (line) => Boolean(line.translation?.trim()) ||
        Boolean(line.translationSegments?.length),
    )
  ) {
    return "line";
  }
  if (unsyncedTranslation?.trim()) return "unsynced";
  return "original-only";
}

export function hasExistingTranslation(result: ProviderResult): boolean {
  return (
    result.fidelity !== "original-only" ||
    Boolean(result.unsyncedTranslation?.trim())
  );
}

