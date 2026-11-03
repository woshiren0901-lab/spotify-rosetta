import { describe, expect, it } from "vitest";
import { trimCacheRecords } from "../src/core/cache";
import type { CachedTrackRecord } from "../src/types";

function record(trackId: string, lastAccess: number): CachedTrackRecord {
  return {
    trackId,
    candidates: [],
    schemaVersion: 4,
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
});

