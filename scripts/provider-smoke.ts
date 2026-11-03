import { createDefaultProviders } from "../src/providers";
import type { ProviderId, TrackInfo } from "../src/types";

(globalThis as unknown as Record<string, unknown>).window = {
  Spicetify: undefined,
  setTimeout,
  clearTimeout,
};

const args = process.argv.slice(2);
const track: TrackInfo = {
  id: args[4] || "2VxeLyX666F8uXCJ0dZF8B",
  uri: `spotify:track:${args[4] || "2VxeLyX666F8uXCJ0dZF8B"}`,
  title: args[0] || "Easy On Me",
  artists: args[1] ? [args[1]] : ["Adele"],
  album: args[2] || "30",
  durationMs: Number(args[3]) || 224_312,
};

const providerIds = new Set<ProviderId>(["netease", "qq", "musixmatch", "lrclib"]);
for (const provider of createDefaultProviders().filter((item) =>
  providerIds.has(item.id),
)) {
  const controller = new AbortController();
  const started = performance.now();
  try {
    const candidates = await provider.search(track, controller.signal);
    console.log(
      `${provider.id}: ${candidates.length} candidate(s) in ${Math.round(
        performance.now() - started,
      )}ms`,
    );
    if (!candidates[0]) continue;
    console.log(`${provider.id}: candidate ${JSON.stringify(candidates[0])}`);
    const result = await provider.fetch(
      candidates[0],
      track,
      controller.signal,
    );
    console.log(
      `${provider.id}: ${result.lines.length} line(s), coverage ${Math.round(
        result.translationCoverage * 100,
      )}%, fidelity ${result.fidelity}`,
    );
  } catch (error) {
    console.error(
      `${provider.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

