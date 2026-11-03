import type {
  CachedTrackRecord,
  LocalTranslationRecord,
  ManualOverrideRecord,
  RosettaSettings,
} from "../types";

const DB_NAME = "spotify-rosetta";
const DB_VERSION = 2;
const TRACK_STORE = "tracks";
const OVERRIDE_STORE = "manualOverrides";
const LOCAL_STORE = "localTranslations";

export function trimCacheRecords(
  records: CachedTrackRecord[],
  limit: number,
): CachedTrackRecord[] {
  return records
    .slice()
    .sort((left, right) => right.lastAccess - left.lastAccess)
    .slice(0, Math.max(1, limit));
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

export class RosettaCache {
  private databasePromise?: Promise<IDBDatabase>;

  constructor(
    private readonly databaseName = DB_NAME,
    private readonly settingsProvider: () => RosettaSettings,
  ) {}

  private async open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    if (typeof indexedDB === "undefined") {
      throw new Error("IndexedDB is unavailable.");
    }
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(TRACK_STORE)) {
          database.createObjectStore(TRACK_STORE, { keyPath: "trackId" });
        }
        if (!database.objectStoreNames.contains(OVERRIDE_STORE)) {
          database.createObjectStore(OVERRIDE_STORE, { keyPath: "trackId" });
        }
        if (!database.objectStoreNames.contains(LOCAL_STORE)) {
          database.createObjectStore(LOCAL_STORE, { keyPath: "trackId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open the Rosetta cache."));
    });
    return this.databasePromise;
  }

  async getTrack(trackId: string): Promise<CachedTrackRecord | undefined> {
    try {
      const database = await this.open();
      const transaction = database.transaction(TRACK_STORE, "readwrite");
      const store = transaction.objectStore(TRACK_STORE);
      const record = await requestToPromise(
        store.get(trackId) as IDBRequest<CachedTrackRecord | undefined>,
      );
      if (record) {
        record.lastAccess = Date.now();
        store.put(record);
      }
      await transactionDone(transaction);
      return record;
    } catch {
      return undefined;
    }
  }

  async putTrack(record: CachedTrackRecord): Promise<void> {
    try {
      const database = await this.open();
      const transaction = database.transaction(TRACK_STORE, "readwrite");
      const store = transaction.objectStore(TRACK_STORE);
      store.put(record);
      await transactionDone(transaction);
      await this.trim();
    } catch {
      // Cache failures must not interrupt lyric translation.
    }
  }

  async getOverride(
    trackId: string,
  ): Promise<ManualOverrideRecord | undefined> {
    try {
      const database = await this.open();
      const transaction = database.transaction(OVERRIDE_STORE, "readonly");
      const record = await requestToPromise(
        transaction.objectStore(OVERRIDE_STORE).get(trackId) as IDBRequest<
          ManualOverrideRecord | undefined
        >,
      );
      await transactionDone(transaction);
      return record;
    } catch {
      return undefined;
    }
  }

  async putOverride(record: ManualOverrideRecord): Promise<void> {
    try {
      const database = await this.open();
      const transaction = database.transaction(OVERRIDE_STORE, "readwrite");
      transaction.objectStore(OVERRIDE_STORE).put(record);
      await transactionDone(transaction);
    } catch {
      // Manual override still works for the current session.
    }
  }

  async getLocal(
    trackId: string,
  ): Promise<LocalTranslationRecord | undefined> {
    try {
      const database = await this.open();
      const transaction = database.transaction(LOCAL_STORE, "readonly");
      const record = await requestToPromise(
        transaction.objectStore(LOCAL_STORE).get(trackId) as IDBRequest<
          LocalTranslationRecord | undefined
        >,
      );
      await transactionDone(transaction);
      return record;
    } catch {
      return undefined;
    }
  }

  async putLocal(record: LocalTranslationRecord): Promise<void> {
    try {
      const database = await this.open();
      const transaction = database.transaction(LOCAL_STORE, "readwrite");
      transaction.objectStore(LOCAL_STORE).put(record);
      await transactionDone(transaction);
    } catch {
      // Local imports remain available for the current session.
    }
  }

  async clear(): Promise<void> {
    try {
      const database = await this.open();
      const transaction = database.transaction(
        [TRACK_STORE, OVERRIDE_STORE, LOCAL_STORE],
        "readwrite",
      );
      transaction.objectStore(TRACK_STORE).clear();
      transaction.objectStore(OVERRIDE_STORE).clear();
      transaction.objectStore(LOCAL_STORE).clear();
      await transactionDone(transaction);
    } catch {
      // Nothing else to do when the cache cannot be opened.
    }
  }

  async close(): Promise<void> {
    try {
      const database = await this.databasePromise;
      database?.close();
    } finally {
      this.databasePromise = undefined;
    }
  }

  private async trim(): Promise<void> {
    try {
      const database = await this.open();
      const transaction = database.transaction(TRACK_STORE, "readwrite");
      const records = await requestToPromise(
        transaction.objectStore(TRACK_STORE).getAll() as IDBRequest<
          CachedTrackRecord[]
        >,
      );
      const keep = new Set(
        trimCacheRecords(records, this.settingsProvider().cacheLimit).map(
          (record) => record.trackId,
        ),
      );
      for (const record of records) {
        if (!keep.has(record.trackId)) {
          transaction.objectStore(TRACK_STORE).delete(record.trackId);
        }
      }
      await transactionDone(transaction);
    } catch {
      // The next successful cache operation will retry trimming.
    }
  }
}

