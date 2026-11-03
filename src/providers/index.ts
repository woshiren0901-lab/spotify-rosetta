import type { LyricsProvider, ProviderId, TrackInfo } from "../types";
import { NeteaseProvider } from "./netease";
import { QQMusicProvider } from "./qq";
import { MusixmatchProvider } from "./musixmatch";
import { LrclibProvider } from "./lrclib";
import { SpotifyProvider } from "./spotify";
import { LyricsTranslateProvider } from "./lyricstranslate";
import { WebTranslationProvider } from "./webTranslation";
import { scoreCandidate } from "../core/ranking";

export function createDefaultProviders(): LyricsProvider[] {
  return [
    new NeteaseProvider(),
    new QQMusicProvider(),
    new MusixmatchProvider(),
    new LyricsTranslateProvider(),
    new WebTranslationProvider(),
    new LrclibProvider(),
    new SpotifyProvider(),
  ];
}

export async function searchProvider<T extends LyricsProvider>(
  provider: T,
  track: TrackInfo,
  signal: AbortSignal,
) {
  const candidates = await provider.search(track, signal);
  return candidates
    .map((candidate) => scoreCandidate(track, candidate))
    .filter((candidate) => candidate.eligible)
    .sort((left, right) => right.matchScore - left.matchScore);
}

export function providerSupportsTranslations(id: ProviderId): boolean {
  return (
    id === "netease" ||
    id === "qq" ||
    id === "musixmatch" ||
    id === "lyricstranslate" ||
    id === "web"
  );
}

