import { describe, expect, it } from "vitest";
import {
  inferLyricsLanguage,
  normalizeIsrc,
  normalizeLyricText,
  normalizeText,
  translationCoverage,
} from "../src/core/normalize";
import {
  chooseBestResult,
  isrcCompatibility,
  languageCompatibility,
  rankProviderResults,
  scoreCandidate,
} from "../src/core/ranking";
import { searchTrackVariants } from "../src/providers/common";
import type { ProviderCandidate, ProviderResult, TrackInfo } from "../src/types";

const track: TrackInfo = {
  id: "track-1",
  uri: "spotify:track:track-1",
  title: "Example Song",
  artists: ["Example Artist"],
  album: "Example Album",
  durationMs: 210_000,
};

function candidate(overrides: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    providerId: "netease",
    sourceId: "song-1",
    title: "Example Song",
    artists: ["Example Artist"],
    album: "Example Album",
    durationMs: 210_500,
    ...overrides,
  };
}

function result(
  providerId: ProviderResult["providerId"],
  overrides: Partial<ProviderResult> = {},
): ProviderResult {
  return {
    providerId,
    candidate: candidate({ providerId }),
    matchScore: 0.9,
    translationCoverage: 0.8,
    fidelity: "line",
    lines: [
      {
        startMs: 1_000,
        original: "Example line",
        translation: "示例译文",
      },
    ],
    fetchedAt: 1,
    ...overrides,
  };
}

describe("text normalization", () => {
  it("normalizes punctuation, quotes, width, and lyric spacing", () => {
    expect(normalizeText("  Example—SONG  ")).toBe("example song");
    expect(normalizeLyricText("“Don't” stop!")).toBe("dontstop");
    expect(normalizeLyricText("中文，歌词！")).toBe("中文歌词");
  });

  it("calculates line translation coverage", () => {
    expect(
      translationCoverage([
        { startMs: 1, original: "a", translation: "甲" },
        { startMs: 2, original: "b", translation: "" },
      ]),
    ).toBe(0.5);
  });

  it("infers the source language from native lyric scripts", () => {
    expect(
      inferLyricsLanguage([
        { startMs: 1, original: "これは日本語の歌です" },
      ]),
    ).toBe("ja");
    expect(
      inferLyricsLanguage([
        { startMs: 1, original: "이것은 한국어 노래입니다" },
      ]),
    ).toBe("ko");
    expect(
      inferLyricsLanguage([
        { startMs: 1, original: "This is an English song" },
      ]),
    ).toBe("en");
  });
});

describe("candidate ranking", () => {
  it("scores an exact version highly", () => {
    const scored = scoreCandidate(track, candidate());
    expect(scored.eligible).toBe(true);
    expect(scored.matchScore).toBeGreaterThan(0.9);
  });

  it("rejects a live version when Spotify is playing the studio version", () => {
    const scored = scoreCandidate(
      track,
      candidate({
        title: "Example Song (Live)",
        durationMs: 260_000,
      }),
    );
    expect(scored.eligible).toBe(false);
  });

  it("rejects a translation for a different language version", () => {
    const japaneseTrack: TrackInfo = {
      ...track,
      languageHints: ["ja"],
    };
    const englishVersion = candidate({
      title: "Example Song (English ver.)",
      sourceLanguage: "en",
    });
    expect(languageCompatibility(japaneseTrack, englishVersion)).toBe(0);
    expect(scoreCandidate(japaneseTrack, englishVersion).eligible).toBe(false);
  });

  it("rejects an exact-title song by a different artist", () => {
    const wrongArtist = candidate({
      title: "Example Song",
      artists: ["Different Artist"],
      album: "",
      durationMs: 0,
    });
    expect(scoreCandidate(track, wrongArtist).eligible).toBe(false);
  });

  it("uses ISRC as the primary recording identity", () => {
    expect(normalizeIsrc("isrc: us-s1z-99-00001")).toBe("USS1Z9900001");
    const isrcTrack: TrackInfo = {
      ...track,
      isrc: "USS1Z9900001",
    };
    const localizedTitle = candidate({
      title: "Example Song (Localized)",
      isrc: "US-S1Z-99-00001",
    });
    expect(isrcCompatibility(isrcTrack, localizedTitle)).toBe(1);
    expect(scoreCandidate(isrcTrack, localizedTitle).eligible).toBe(true);

    const wrongIsrc = candidate({ isrc: "GBAAA0000002" });
    expect(isrcCompatibility(isrcTrack, wrongIsrc)).toBe(0);
    expect(scoreCandidate(isrcTrack, wrongIsrc).eligible).toBe(false);
  });

  it("accepts a translation whose source language matches Spotify", () => {
    const japaneseTrack: TrackInfo = {
      ...track,
      languageHints: ["ja"],
    };
    const japaneseVersion = candidate({
      title: "Example Song",
      sourceLanguage: "ja",
    });
    expect(languageCompatibility(japaneseTrack, japaneseVersion)).toBe(1);
    expect(scoreCandidate(japaneseTrack, japaneseVersion).eligible).toBe(true);
  });

  it("treats an explicit language-version title as a hard match", () => {
    const englishTrack: TrackInfo = {
      ...track,
      title: "Example Song (English ver.)",
    };
    expect(
      scoreCandidate(
        englishTrack,
        candidate({
          title: "Example Song",
          sourceLanguage: "ja",
        }),
      ).eligible,
    ).toBe(false);
    expect(
      scoreCandidate(
        englishTrack,
        candidate({
          title: "Example Song (English Version)",
          sourceLanguage: "en",
        }),
      ).eligible,
    ).toBe(true);
  });

  it("prefers word timing when match and coverage are equal", () => {
    const ranked = rankProviderResults([
      result("musixmatch", { fidelity: "line" }),
      result("netease", { fidelity: "word" }),
    ]);
    expect(ranked[0]?.providerId).toBe("netease");
  });

  it("does not select original-only results when a translation exists", () => {
    const best = chooseBestResult(
      [
        result("spotify", { fidelity: "original-only", translationCoverage: 0 }),
        result("qq", { fidelity: "line" }),
      ],
      true,
    );
    expect(best?.providerId).toBe("qq");
  });

  it("uses localized title and artist aliases for the same recording", () => {
    const localizedTrack: TrackInfo = {
      ...track,
      title: "Tsuki no Mayu",
      titleAliases: ["月の繭"],
      artists: ["奥井亚纪"],
      artistAliases: ["奥井亜紀"],
      album: "月の繭",
      durationMs: 338_000,
    };
    const scored = scoreCandidate(
      localizedTrack,
      candidate({
        title: "月の繭",
        artists: ["奥井亜紀"],
        album: "月の繭",
        durationMs: 338_000,
      }),
    );
    expect(scored.eligible).toBe(true);
    expect(scored.matchScore).toBeGreaterThan(0.8);
  });

  it("generates bounded search variants for aliases", () => {
    const variants = searchTrackVariants({
      ...track,
      title: "Tsuki no Mayu",
      titleAliases: ["月の繭"],
      artists: ["奥井亚纪"],
      artistAliases: ["奥井亜紀"],
    });
    expect(variants.length).toBeLessThanOrEqual(4);
    expect(variants.map((variant) => variant.title)).toContain("月の繭");
    expect(
      variants.flatMap((variant) => variant.artists),
    ).toContain("奥井亜紀");
  });
});

