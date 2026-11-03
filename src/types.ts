export type ProviderId =
  | "netease"
  | "qq"
  | "musixmatch"
  | "lyricstranslate"
  | "web"
  | "lrclib"
  | "spotify"
  | "local";

export type SyncFidelity = "word" | "line" | "unsynced" | "original-only";

export interface TrackInfo {
  id: string;
  uri: string;
  title: string;
  titleAliases?: string[];
  artists: string[];
  artistAliases?: string[];
  album: string;
  albumAliases?: string[];
  isrc?: string;
  languageHints?: string[];
  durationMs: number;
}

export interface ProviderCandidate {
  providerId: ProviderId;
  sourceId: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
  isrc?: string;
  sourceLanguage?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  extra?: Record<string, string>;
}

export interface WordSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranslationSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface LyricsLine {
  startMs: number;
  endMs?: number;
  original: string;
  translation?: string;
  wordSegments?: WordSegment[];
  translationSegments?: TranslationSegment[];
}

export interface ProviderResult {
  providerId: ProviderId;
  candidate: ProviderCandidate;
  matchScore: number;
  translationCoverage: number;
  fidelity: SyncFidelity;
  lines: LyricsLine[];
  unsyncedTranslation?: string;
  attributionUrl?: string;
  fetchedAt: number;
}

export interface ProviderCandidateScore {
  candidate: ProviderCandidate;
  matchScore: number;
  eligible: boolean;
}

export interface RankedCandidate extends ProviderCandidateScore {
  result?: ProviderResult;
}

export interface ProviderDiagnostic {
  providerId: ProviderId;
  status: "ok" | "empty" | "timeout" | "error" | "cooldown";
  message?: string;
  elapsedMs?: number;
}

export interface LoadOutcome {
  result?: ProviderResult;
  diagnostics: ProviderDiagnostic[];
  provisional: boolean;
}

export interface LyricsProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly providesTranslations: boolean;
  search(track: TrackInfo, signal: AbortSignal): Promise<ProviderCandidate[]>;
  fetch(
    candidate: ProviderCandidate,
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<ProviderResult>;
}

export interface ProviderSettings {
  netease: boolean;
  qq: boolean;
  musixmatch: boolean;
  lyricstranslate: boolean;
  web: boolean;
  lrclib: boolean;
  spotify: boolean;
  local: boolean;
}

export interface RosettaSettings {
  schemaVersion: 1;
  enabled: boolean;
  showPartial: boolean;
  showUnsynced: boolean;
  wordHighlight: boolean;
  cacheLimit: number;
  providers: ProviderSettings;
}

export interface CachedTrackRecord {
  trackId: string;
  result?: ProviderResult;
  candidates: ProviderCandidate[];
  manualProviderId?: ProviderId;
  schemaVersion: 4;
  updatedAt: number;
  lastAccess: number;
}

export interface ManualOverrideRecord {
  trackId: string;
  providerId: ProviderId;
  candidate: ProviderCandidate;
  result: ProviderResult;
  updatedAt: number;
}

export interface LocalTranslationRecord {
  trackId: string;
  result: ProviderResult;
  sourceName: string;
  importedAt: number;
}

export interface ManualSearchEntry {
  providerId: ProviderId;
  providerLabel: string;
  candidate: ProviderCandidate;
  matchScore: number;
  coverage?: number;
  fidelity?: SyncFidelity;
  result?: ProviderResult;
}

