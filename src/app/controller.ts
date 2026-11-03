import type {
  LyricsLine,
  LyricsProvider,
  ManualSearchEntry,
  ProviderCandidate,
  ProviderDiagnostic,
  ProviderId,
  ProviderResult,
  RosettaSettings,
  TrackInfo,
} from "../types";
import { RosettaCache } from "../core/cache";
import {
  ProviderHttpError,
  asString,
  readPath,
  requestJson,
} from "../core/http";
import {
  hasExistingTranslation,
  inferLyricsLanguage,
  normalizeIsrc,
  normalizeLanguage,
  normalizeText,
} from "../core/normalize";
import { lyricSourceMatchRatio } from "../core/alignment";
import { hydrateTranslationOnlyResult } from "../core/translationHydration";
import { chooseBestResult } from "../core/ranking";
import { parseLocalTranslation } from "../core/localTranslation";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from "../core/settings";
import { NativeLyricsRenderer } from "../dom/nativeLyrics";
import {
  createDefaultProviders,
  searchProvider,
} from "../providers";
import { fetchWebTranslationFromUrl } from "../providers/webTranslation";

export type TranslationStatus =
  | "idle"
  | "loading"
  | "word"
  | "line"
  | "partial"
  | "unsynced"
  | "none"
  | "error"
  | "disabled";

export interface RosettaUiSnapshot {
  enabled: boolean;
  loading: boolean;
  status: TranslationStatus;
  statusText: string;
  track?: TrackInfo;
  result?: ProviderResult;
  nativeLines?: LyricsLine[];
  diagnostics: ProviderDiagnostic[];
}

export interface ManualQuery {
  title: string;
  artist: string;
  album: string;
}

type UpdateListener = (snapshot: RosettaUiSnapshot) => void;

function trackIdFromUri(uri: string | undefined): string | undefined {
  const match = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri ?? "");
  return match?.[1];
}

function providerEnabled(
  settings: RosettaSettings,
  providerId: ProviderId,
): boolean {
  return settings.providers[providerId];
}

function statusFromResult(
  result: ProviderResult | undefined,
): TranslationStatus {
  if (!result) return "none";
  if (result.fidelity === "word") {
    return result.translationCoverage < 0.999 ? "partial" : "word";
  }
  if (result.fidelity === "line") {
    return result.translationCoverage < 0.999 ? "partial" : "line";
  }
  if (result.fidelity === "unsynced") return "unsynced";
  return "none";
}

function statusTextFor(result: ProviderResult | undefined): string {
  if (!result) return "未找到可访问的现成中文翻译";
  if (result.fidelity === "original-only") {
    return "未找到可访问的现成中文翻译";
  }
  if (result.fidelity === "unsynced") {
    return `已找到非同步译文 · ${result.candidate.sourceLabel ?? result.providerId}`;
  }
  const source = result.candidate.sourceLabel ?? result.providerId;
  if (result.translationCoverage < 0.999) {
    return `部分翻译 ${Math.round(result.translationCoverage * 100)}% · ${source}`;
  }
  return `${result.fidelity === "word" ? "逐字翻译" : "逐行翻译"} · ${source}`;
}

export class RosettaController {
  private readonly cache: RosettaCache;
  private readonly renderer: NativeLyricsRenderer;
  private readonly providers: LyricsProvider[];
  private readonly listeners = new Set<UpdateListener>();
  private readonly cooldowns = new Map<ProviderId, number>();
  private settings: RosettaSettings;
  private currentTrack?: TrackInfo;
  private currentResult?: ProviderResult;
  private currentNativeLines?: LyricsLine[];
  private diagnostics: ProviderDiagnostic[] = [];
  private status: TranslationStatus = "idle";
  private statusText = "等待 Spotify 播放歌曲";
  private loading = false;
  private started = false;
  private generation = 0;
  private abortController?: AbortController;
  private pollTimer?: number;
  private progressTimer?: number;
  private lastProgressAt = 0;

  constructor(
    providers: LyricsProvider[] = createDefaultProviders(),
    renderer: NativeLyricsRenderer = new NativeLyricsRenderer(),
  ) {
    this.providers = providers;
    this.renderer = renderer;
    this.settings = loadSettings();
    this.cache = new RosettaCache(
      "spotify-rosetta",
      () => this.settings,
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.renderer.start();
    const player = window.Spicetify?.Player;
    player?.addEventListener?.("songchange", this.handleSongChange);
    player?.addEventListener?.("appchange", this.handleSongChange);
    this.pollTimer = window.setInterval(() => {
      const track = this.readCurrentTrack();
      if (track?.id !== this.currentTrack?.id) {
        this.handleSongChange();
      }
    }, 3_000);

    this.progressTimer = window.setInterval(() => {
      const now = performance.now();
      if (now - this.lastProgressAt < 100) return;
      this.lastProgressAt = now;
      const progress = window.Spicetify?.Player?.getProgress?.();
      if (typeof progress === "number" && Number.isFinite(progress)) {
        this.renderer.setProgress(progress);
      }
    }, 50);

    void this.refreshCurrent(false);
    this.emit();
  }

  dispose(): void {
    if (!this.started) return;
    this.started = false;
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = undefined;
    window.Spicetify?.Player?.removeEventListener?.(
      "songchange",
      this.handleSongChange,
    );
    window.Spicetify?.Player?.removeEventListener?.(
      "appchange",
      this.handleSongChange,
    );
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    if (this.progressTimer) window.clearInterval(this.progressTimer);
    this.pollTimer = undefined;
    this.progressTimer = undefined;
    this.renderer.dispose();
    void this.cache.close();
  }

  getSettings(): RosettaSettings {
    return normalizeSettings(this.settings);
  }

  getSnapshot(): RosettaUiSnapshot {
    return {
      enabled: this.settings.enabled,
      loading: this.loading,
      status: this.status,
      statusText: this.statusText,
      track: this.currentTrack,
      result: this.currentResult,
      nativeLines: this.currentNativeLines,
      diagnostics: this.diagnostics.slice(),
    };
  }

  subscribe(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  async updateSettings(
    patch: Partial<Omit<RosettaSettings, "schemaVersion" | "providers">> & {
      providers?: Partial<RosettaSettings["providers"]>;
    },
  ): Promise<void> {
    this.settings = normalizeSettings({
      ...this.settings,
      ...patch,
      providers: {
        ...this.settings.providers,
        ...(patch.providers ?? {}),
      },
    });
    saveSettings(this.settings);
    this.renderer.setState({
      enabled: this.settings.enabled,
      settings: this.settings,
      result: this.currentResult,
      nativeLines: this.currentNativeLines,
      statusText: this.statusText,
      loading: this.loading,
    });
    if (!this.settings.enabled) {
      this.abortController?.abort();
      this.loading = false;
      this.status = "disabled";
      this.statusText = "译文已关闭，Spotify 原生歌词保持不变";
    } else {
      await this.refreshCurrent(true);
    }
    this.emit();
  }

  async refreshCurrent(force = true): Promise<void> {
    const track = this.readCurrentTrack();
    if (!track) {
      this.clearTrack("当前没有正在播放的 Spotify 歌曲");
      return;
    }
    if (
      !force &&
      this.currentTrack?.id === track.id &&
      (this.loading || this.currentResult)
    ) {
      return;
    }
    await this.loadTrack(track, force);
  }

  private handleSongChange = (): void => {
    void this.refreshCurrent(true);
  };

  private readCurrentTrack(): TrackInfo | undefined {
    const item = window.Spicetify?.Player?.data?.item;
    if (!item) return undefined;
    const metadata = item.metadata ?? {};
    const uri = item.uri ?? metadata.uri;
    const id = trackIdFromUri(uri);
    if (!id) return undefined;
    const artists = item.artists
      ?.map((artist) => artist.name?.trim() ?? "")
      .filter(Boolean);
    const metadataArtists = metadata.artist_name
      ?.split(/\s*,\s*/)
      .map((artist) => artist.trim())
      .filter(Boolean);
    const canonicalTitle =
      item.name?.trim() || metadata.title?.trim() || "Unknown track";
    const canonicalArtists = artists?.length
      ? artists
      : metadataArtists?.length
        ? metadataArtists
        : [item.artist ?? "Unknown artist"];
    const canonicalAlbum = item.album?.name ?? metadata.album_title ?? "";
    const domAliases = collectDomTrackAliases(id);
    const titleAliases = uniqueStrings([
      canonicalTitle,
      metadata.title,
      metadata.title_localized,
      metadata.title_translation,
      metadata.original_title,
      metadata.track_name,
      metadata.song_title,
      ...domAliases,
    ]).filter(
      (title) =>
        title.toLocaleLowerCase() !== canonicalTitle.toLocaleLowerCase() &&
        !canonicalArtists.some(
          (artist) =>
            artist.toLocaleLowerCase() === title.toLocaleLowerCase(),
        ),
    );
    const artistAliases = uniqueStrings([
      ...canonicalArtists,
      metadata.artist_name,
      metadata.artist_name_localized,
      metadata.artist,
      metadata.album_artist_name,
      ...(metadata.artists ?? "").split(/\s*,\s*/),
    ]).filter(
      (artist) =>
        !canonicalArtists.some(
          (canonical) =>
            canonical.toLocaleLowerCase() === artist.toLocaleLowerCase(),
        ),
    );
    const albumAliases = uniqueStrings([
      canonicalAlbum,
      metadata.album_title,
      metadata.album,
      metadata.album_title_localized,
    ]).filter(
      (album) =>
        album.toLocaleLowerCase() !== canonicalAlbum.toLocaleLowerCase(),
    );
    const languageHints = uniqueStrings(
      Object.entries(metadata)
        .filter(([key]) => /lang/i.test(key))
        .map(([, value]) => normalizeLanguage(value) ?? ""),
    );
    const isrc = normalizeIsrc(
      [
        metadata.isrc,
        metadata.external_id,
        metadata.external_ids,
        metadata.original_isrc,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return {
      id,
      uri: uri ?? `spotify:track:${id}`,
      title: canonicalTitle,
      titleAliases,
      artists: canonicalArtists,
      artistAliases,
      album: canonicalAlbum,
      albumAliases,
      isrc,
      languageHints,
      durationMs:
        item.duration?.milliseconds ??
        (Number(metadata.duration) || 0) * (metadata.duration ? 1 : 0),
    };
  }

  private clearTrack(message: string): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = undefined;
    this.currentTrack = undefined;
    this.currentResult = undefined;
    this.currentNativeLines = undefined;
    this.diagnostics = [];
    this.loading = false;
    this.status = "idle";
    this.statusText = message;
    this.renderer.setState({
      enabled: this.settings.enabled,
      settings: this.settings,
      nativeLines: this.currentNativeLines,
      loading: false,
      statusText: message,
    });
    this.emit();
  }

  private async loadTrack(
    track: TrackInfo,
    skipCache = false,
    aliasRetry = false,
  ): Promise<void> {
    const generation = ++this.generation;
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.currentTrack = track;
    this.currentResult = undefined;
    this.currentNativeLines = undefined;
    this.diagnostics = [];
    this.loading = this.settings.enabled;
    this.status = this.settings.enabled ? "loading" : "disabled";
    this.statusText = this.settings.enabled
      ? "正在查找现成翻译…"
      : "译文已关闭，Spotify 原生歌词保持不变";
    this.publishRenderer();
    this.emit();

    if (!this.settings.enabled) {
      this.loading = false;
      this.emit();
      return;
    }

    const override = await this.cache.getOverride(track.id);
    if (generation !== this.generation) return;
    if (override && providerEnabled(this.settings, override.providerId)) {
      this.loading = false;
      this.publishResult(override.result, []);
      void this.refreshNativeLines(track, generation, abortController.signal);
      return;
    }

    const local = this.settings.providers.local
      ? await this.cache.getLocal(track.id)
      : undefined;
    if (generation !== this.generation) return;
    if (local) {
      this.loading = false;
      this.publishResult(local.result, [
        {
          providerId: "local",
          status: "ok",
          message: local.sourceName,
        },
      ]);
      void this.refreshNativeLines(track, generation, abortController.signal);
      return;
    }

    const cached = skipCache ? undefined : await this.cache.getTrack(track.id);
    if (generation !== this.generation) return;
    if (
      cached?.schemaVersion === 4 &&
      cached.result &&
      cached.result.fidelity !== "original-only"
    ) {
      this.loading = false;
      this.publishResult(cached.result, []);
      void this.refreshNativeLines(track, generation, abortController.signal);
      return;
    }

    const enabledProviders = this.providers.filter(
      (provider) =>
        provider.providesTranslations &&
        providerEnabled(this.settings, provider.id),
    );
    await this.resolveTrackIsrc(track, abortController.signal);
    if (generation !== this.generation || abortController.signal.aborted) {
      return;
    }
    const allCandidates: ProviderCandidate[] = [];
    const results: ProviderResult[] = [];
    const nativeLinesPromise = this.fetchNativeLines(
      track,
      abortController.signal,
    ).catch(() => undefined);
    if (!track.languageHints?.length) {
      const inferredLanguage = await Promise.race([
        nativeLinesPromise.then((lines) =>
          lines?.length ? inferLyricsLanguage(lines) : undefined,
        ),
        new Promise<undefined>((resolve) => {
          window.setTimeout(() => resolve(undefined), 1_800);
        }),
      ]);
      if (generation !== this.generation || abortController.signal.aborted) {
        return;
      }
      if (inferredLanguage) {
        track.languageHints = uniqueStrings([
          ...(track.languageHints ?? []),
          inferredLanguage,
        ]);
      }
    }
    let provisionalPublished = false;
    const workers = enabledProviders.map(
      async (provider): Promise<ProviderDiagnostic> => {
        const startedAt = performance.now();
        const now = Date.now();
        const cooldownUntil = this.cooldowns.get(provider.id) ?? 0;
        if (cooldownUntil > now) {
          return {
            providerId: provider.id,
            status: "cooldown" as const,
            message: `来源冷却中，约 ${Math.ceil((cooldownUntil - now) / 1_000)} 秒后重试`,
          };
        }

        const sourceAbort = new AbortController();
        const abortSource = () => sourceAbort.abort();
        abortController.signal.addEventListener("abort", abortSource, {
          once: true,
        });
        const sourceTimeout = window.setTimeout(
          () => sourceAbort.abort(),
          12_000,
        );

        try {
          const ranked = await searchProvider(
            provider,
            track,
            sourceAbort.signal,
          );
          allCandidates.push(...ranked.map((entry) => entry.candidate));
          if (!ranked.length) {
            return {
              providerId: provider.id,
              status: "empty" as const,
              message:
                provider.id === "netease" || provider.id === "qq"
                  ? "该大陆曲库未返回候选，不代表不存在中文翻译"
                  : "没有高置信匹配结果",
              elapsedMs: Math.round(performance.now() - startedAt),
            };
          }

          let lastError: unknown;
          for (const candidate of ranked.slice(0, 2)) {
            try {
              let result = await provider.fetch(
                candidate.candidate,
                track,
                sourceAbort.signal,
              );
              const nativeLines = await nativeLinesPromise;
              result = hydrateTranslationOnlyResult(result, nativeLines);
              if (!hasExistingTranslation(result)) {
                throw new Error("来源没有返回同源中文译文。");
              }
              if (nativeLines?.length) {
                const sourceMatch = lyricSourceMatchRatio(
                  nativeLines,
                  result.lines,
                );
                if (sourceMatch < 0.2) {
                  throw new Error(
                    `来源歌词与 Spotify 原文不匹配（${Math.round(
                      sourceMatch * 100,
                    )}%）。`,
                  );
                }
              }
              results.push(result);
              if (
                generation === this.generation &&
                !provisionalPublished &&
                hasExistingTranslation(result)
              ) {
                provisionalPublished = true;
                this.loading = false;
                this.publishResult(result, []);
              }
              return {
                providerId: provider.id,
                status: "ok" as const,
                elapsedMs: Math.round(performance.now() - startedAt),
              };
            } catch (error) {
              lastError = error;
              if (sourceAbort.signal.aborted) throw error;
            }
          }
          throw lastError ?? new Error("没有可用歌词结果");
        } catch (error) {
          if (sourceAbort.signal.aborted) {
            return {
              providerId: provider.id,
              status: "timeout" as const,
              message: abortController.signal.aborted
                ? "歌曲已切换，请求已取消"
                : "查询超时",
              elapsedMs: Math.round(performance.now() - startedAt),
            };
          }
          if (error instanceof ProviderHttpError && error.cooldownMs > 0) {
            this.cooldowns.set(provider.id, Date.now() + error.cooldownMs);
          }
          return {
            providerId: provider.id,
            status: "error" as const,
            message: error instanceof Error ? error.message : String(error),
            elapsedMs: Math.round(performance.now() - startedAt),
          };
        } finally {
          window.clearTimeout(sourceTimeout);
          abortController.signal.removeEventListener("abort", abortSource);
        }
      }
    );

    const diagnosticResults: ProviderDiagnostic[] = await Promise.all(workers);
    if (generation !== this.generation || abortController.signal.aborted) return;
    this.currentNativeLines = await nativeLinesPromise;
    if (generation !== this.generation || abortController.signal.aborted) return;

    const lrclibProvider = this.providers.find(
      (provider) => provider.id === "lrclib",
    );
    if (!results.some((result) => result.fidelity !== "original-only")) {
      if (
        lrclibProvider &&
        this.settings.providers.lrclib &&
        !this.cooldowns.has("lrclib")
      ) {
        try {
          const ranked = await searchProvider(
            lrclibProvider,
            track,
            abortController.signal,
          );
          if (ranked[0]) {
            const result = await lrclibProvider.fetch(
              ranked[0].candidate,
              track,
              abortController.signal,
            );
            results.push(result);
            allCandidates.push(...ranked.map((entry) => entry.candidate));
            diagnosticResults.push({
              providerId: "lrclib",
              status: "ok",
              elapsedMs: 0,
            });
          }
        } catch (error) {
          diagnosticResults.push({
            providerId: "lrclib",
            status: "error",
            message: error instanceof Error ? error.message : String(error),
            elapsedMs: 0,
          });
        }
      }
    }

    this.diagnostics = diagnosticResults;
    const best = chooseBestResult(results, true);
    if (!best) {
      this.loading = false;
      this.status = "none";
      this.statusText = "未找到可访问的现成中文翻译";
      this.currentResult = undefined;
      this.renderer.setState({
        enabled: this.settings.enabled,
        settings: this.settings,
        nativeLines: this.currentNativeLines,
        loading: false,
        statusText: this.statusText,
      });
      this.emit();
      if (!aliasRetry) {
        window.setTimeout(() => {
          void this.retryWithLaterAliases(track, generation);
        }, 1_200);
      }
      return;
    }

    this.loading = false;
    this.publishResult(best, diagnosticResults);
    await this.cache.putTrack({
      trackId: track.id,
      result: best,
      candidates: dedupeCandidates(allCandidates),
      schemaVersion: 4,
      updatedAt: Date.now(),
      lastAccess: Date.now(),
    });
  }

  private async retryWithLaterAliases(
    previousTrack: TrackInfo,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation) return;
    const refreshed = this.readCurrentTrack();
    if (!refreshed || refreshed.id !== previousTrack.id) return;
    const previousTitles = new Set(
      [previousTrack.title, ...(previousTrack.titleAliases ?? [])].map(
        (title) => title.toLocaleLowerCase(),
      ),
    );
    const hasNewTitle = [refreshed.title, ...(refreshed.titleAliases ?? [])].some(
      (title) => !previousTitles.has(title.toLocaleLowerCase()),
    );
    if (hasNewTitle) {
      await this.loadTrack(refreshed, true, true);
    }
  }

  private publishResult(
    result: ProviderResult,
    diagnostics: ProviderDiagnostic[],
  ): void {
    this.currentResult = result;
    this.diagnostics = diagnostics;
    this.status = statusFromResult(result);
    this.statusText = statusTextFor(result);
    this.publishRenderer();
    this.emit();
  }

  private publishRenderer(): void {
    this.renderer.setState({
      enabled: this.settings.enabled,
      settings: this.settings,
      result: this.currentResult,
      nativeLines: this.currentNativeLines,
      loading: this.loading,
      statusText: this.statusText,
    });
  }

  private async fetchNativeLines(
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<LyricsLine[] | undefined> {
    const provider = this.providers.find(
      (candidate) => candidate.id === "spotify",
    );
    if (!provider || !this.settings.providers.spotify) return undefined;
    const candidates = await provider.search(track, signal);
    const candidate = candidates[0];
    if (!candidate) return undefined;
    const result = await provider.fetch(candidate, track, signal);
    return result.lines;
  }

  private async resolveTrackIsrc(
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<void> {
    if (track.isrc) return;
    try {
      const response = await requestJson<unknown>(
        `https://api.spotify.com/v1/tracks/${encodeURIComponent(track.id)}`,
        {
          signal,
          timeoutMs: 4_000,
        },
      );
      const isrc = normalizeIsrc(
        asString(readPath(response, ["external_ids", "isrc"])),
      );
      if (isrc) track.isrc = isrc;
    } catch {
      // ISRC is an exact-match accelerator; metadata fallback remains valid.
    }
  }

  private async refreshNativeLines(
    track: TrackInfo,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const nativeLines = await this.fetchNativeLines(track, signal);
      if (generation !== this.generation || signal.aborted) return;
      this.currentNativeLines = nativeLines;
      this.publishRenderer();
    } catch {
      // Native lines improve alignment but are optional.
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
    this.statusText = "缓存已清空";
    this.emit();
  }

  async importLocalTranslation(
    text: string,
    sourceName: string,
  ): Promise<ProviderResult> {
    const track = this.currentTrack ?? this.readCurrentTrack();
    if (!track) throw new Error("当前没有正在播放的 Spotify 歌曲。");
    const signal = this.abortController?.signal ?? new AbortController().signal;
    const nativeLines =
      this.currentNativeLines ??
      (await this.fetchNativeLines(track, signal).catch(() => undefined));
    const result = parseLocalTranslation(text, {
      track,
      sourceName: sourceName.trim() || "本地文件",
      nativeLines,
    });
    this.currentNativeLines = nativeLines;
    await this.cache.putLocal({
      trackId: track.id,
      result,
      sourceName: sourceName.trim() || "本地文件",
      importedAt: Date.now(),
    });
    await this.cache.putOverride({
      trackId: track.id,
      providerId: "local",
      candidate: result.candidate,
      result,
      updatedAt: Date.now(),
    });
    this.loading = false;
    this.publishResult(result, [
      {
        providerId: "local",
        status: "ok",
        message: result.candidate.sourceLabel,
      },
    ]);
    return result;
  }

  async importWebTranslation(sourceUrl: string): Promise<ProviderResult> {
    const track = this.currentTrack ?? this.readCurrentTrack();
    if (!track) throw new Error("当前没有正在播放的 Spotify 歌曲。");
    const signal = new AbortController().signal;
    const nativeLines =
      this.currentNativeLines ??
      (await this.fetchNativeLines(track, signal).catch(() => undefined));
    let result = await fetchWebTranslationFromUrl(sourceUrl, track, signal);
    result = hydrateTranslationOnlyResult(result, nativeLines);
    if (!hasExistingTranslation(result)) {
      throw new Error("网页中没有可用的现成中文译文。");
    }
    if (
      nativeLines?.length &&
      result.lines.some((line) => line.original.trim()) &&
      lyricSourceMatchRatio(nativeLines, result.lines) < 0.2
    ) {
      throw new Error("网页原文与 Spotify 歌词序列不匹配。");
    }
    this.currentNativeLines = nativeLines;
    const sourceName = result.candidate.sourceLabel ?? sourceUrl;
    await this.cache.putLocal({
      trackId: track.id,
      result,
      sourceName,
      importedAt: Date.now(),
    });
    await this.cache.putOverride({
      trackId: track.id,
      providerId: "web",
      candidate: result.candidate,
      result,
      updatedAt: Date.now(),
    });
    this.loading = false;
    this.publishResult(result, [
      {
        providerId: "web",
        status: "ok",
        message: sourceName,
      },
    ]);
    return result;
  }

  async manualSearch(query: ManualQuery): Promise<ManualSearchEntry[]> {
    const current = this.currentTrack ?? this.readCurrentTrack();
    if (!current) return [];
    const syntheticTrack: TrackInfo = {
      ...current,
      title: query.title.trim() || current.title,
      artists: query.artist
        .split(/\s*,\s*/)
        .map((artist) => artist.trim())
        .filter(Boolean),
      album: query.album.trim() || current.album,
    };
    if (!syntheticTrack.artists.length) {
      syntheticTrack.artists = current.artists;
    }
    const abortController = new AbortController();
    const entries: ManualSearchEntry[] = [];

    const searches = this.providers
      .filter((provider) => providerEnabled(this.settings, provider.id))
      .map(async (provider) => {
        try {
          const ranked = await searchProvider(
            provider,
            syntheticTrack,
            abortController.signal,
          );
          for (const candidate of ranked.slice(0, 4)) {
            entries.push({
              providerId: provider.id,
              providerLabel: provider.label,
              candidate: candidate.candidate,
              matchScore: candidate.matchScore,
            });
          }
        } catch {
          // Manual search returns whatever other providers found.
        }
      });
    await Promise.all(searches);

    const top = entries
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, 12);
    await Promise.all(
      top.map(async (entry) => {
        const provider = this.providers.find(
          (candidate) => candidate.id === entry.providerId,
        );
        if (!provider) return;
        try {
          const result = await provider.fetch(
            entry.candidate,
            syntheticTrack,
            abortController.signal,
          );
          entry.result = result;
          entry.coverage = result.translationCoverage;
          entry.fidelity = result.fidelity;
        } catch {
          // The candidate remains visible so the user can see that it failed.
        }
      }),
    );
    return top;
  }

  async applyManualSelection(entry: ManualSearchEntry): Promise<void> {
    const track = this.currentTrack ?? this.readCurrentTrack();
    if (!track) return;
    let result = entry.result;
    if (!result) {
      const provider = this.providers.find(
        (candidate) => candidate.id === entry.providerId,
      );
      if (!provider) throw new Error("Provider 不可用。");
      result = await provider.fetch(
        entry.candidate,
        track,
        new AbortController().signal,
      );
    }
    await this.cache.putOverride({
      trackId: track.id,
      providerId: entry.providerId,
      candidate: entry.candidate,
      result,
      updatedAt: Date.now(),
    });
    this.loading = false;
    this.publishResult(result, this.diagnostics);
  }
}

function dedupeCandidates(
  candidates: ProviderCandidate[],
): ProviderCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.providerId}:${candidate.sourceId}:${normalizeText(
      candidate.title,
    )}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function collectDomTrackAliases(trackId: string): string[] {
  if (typeof document === "undefined") return [];
  const output: string[] = [];
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (!link.href.includes(trackId) || link.href.includes("/artist/")) continue;
    const text = link.textContent?.trim() ?? "";
    if (!text || text.length > 120) continue;
    output.push(text);
  }
  const parts = document.title
    .split(/\s*[•·]\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  output.push(...parts);
  return uniqueStrings(output);
}

export function defaultControllerSettings(): RosettaSettings {
  return normalizeSettings(DEFAULT_SETTINGS);
}

