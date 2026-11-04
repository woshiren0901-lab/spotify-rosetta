import { describe, expect, it } from "vitest";
import {
  isCurrentManualOverride,
  trimCacheRecords,
} from "../src/core/cache";
import type {
  CachedTrackRecord,
  ManualOverrideRecord,
} from "../src/types";

function record(trackId: string, lastAccess: number): CachedTrackRecord {
  return {
    trackId,
    candidates: [],
    schemaVersion: 6,
    updatedAt: lastAccess,
    lastAccess,
  };
}

describe("cache trimming", () => {
  it("keeps the most recently accessed records", () => {
    const kept = trimCacheRecords(
      [record("old", 1), record("new", 3), record("middle", 2)],
      2,
    );
    expect(kept.map((item) => item.trackId)).toEqual(["new", "middle"]);
  });

  it("never returns more records than the configured limit", () => {
    expect(
      trimCacheRecords(
        Array.from({ length: 10 }, (_, index) => record(String(index), index)),
        3,
      ),
    ).toHaveLength(3);
  });

  it("invalidates manual overrides created before track binding was recorded", () => {
    const base: ManualOverrideRecord = {
      trackId: "track-new",
      providerId: "netease",
      candidate: {
        providerId: "netease",
        sourceId: "song",
        title: "Song",
        artists: ["Artist"],
        album: "Album",
        durationMs: 180_000,
      },
      result: {
        providerId: "netease",
        candidate: {
          providerId: "netease",
          sourceId: "song",
          title: "Song",
          artists: ["Artist"],
          album: "Album",
          durationMs: 180_000,
        },
        matchScore: 1,
        translationCoverage: 1,
        fidelity: "line",
        lines: [{ startMs: 1, original: "line", translation: "译文" }],
        fetchedAt: 1,
      },
      updatedAt: 1,
    };

    expect(isCurrentManualOverride(base, "track-new")).toBe(false);
    expect(
      isCurrentManualOverride(
        { ...base, sourceTrackId: "track-new" },
        "track-new",
      ),
    ).toBe(true);
    expect(
      isCurrentManualOverride(
        { ...base, sourceTrackId: "track-old" },
        "track-new",
      ),
    ).toBe(false);
  });
});

