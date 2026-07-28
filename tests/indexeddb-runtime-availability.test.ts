import { afterEach, describe, expect, it } from "vitest";

import {
  INDEXED_DB_DISABLE_TTL_MS,
  storeRuntime,
} from "../src/storage/session-store/globals";
import {
  disableIndexedDb,
  isIndexedDbRuntimeAvailable,
} from "../src/storage/session-store/idb/database";

describe("IndexedDB runtime availability", () => {
  afterEach(() => {
    storeRuntime.indexedDbAvailable = true;
    storeRuntime.indexedDbDisabledUntil = 0;
    storeRuntime.lastIndexedDbOpenError = null;
    storeRuntime.dbPromise = null;
  });

  it("re-enables IndexedDB after the disable TTL elapses", () => {
    const now = 1_000_000;
    disableIndexedDb({ now, reason: "blocked", permanent: false });

    expect(storeRuntime.indexedDbAvailable).toBe(false);
    expect(storeRuntime.indexedDbDisabledUntil).toBe(now + INDEXED_DB_DISABLE_TTL_MS);
    expect(storeRuntime.lastIndexedDbOpenError).toBe("blocked");

    expect(isIndexedDbRuntimeAvailable(now + INDEXED_DB_DISABLE_TTL_MS - 1)).toBe(false);
    expect(isIndexedDbRuntimeAvailable(now + INDEXED_DB_DISABLE_TTL_MS)).toBe(true);
    expect(storeRuntime.indexedDbAvailable).toBe(true);
    expect(storeRuntime.indexedDbDisabledUntil).toBe(0);
  });

  it("keeps permanent disable until explicitly reset", () => {
    disableIndexedDb({ permanent: true, reason: "unavailable", now: 0 });
    expect(isIndexedDbRuntimeAvailable(Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});
