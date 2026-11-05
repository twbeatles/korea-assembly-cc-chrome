import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../src/core/subtitle-models";

const prefix = "assembly-subtitle-session-fallback:";
const indexKey = `${prefix}index`;
const metadataKey = `${prefix}metadata`;
const recordKey = (id: string) => `${prefix}record:${id}`;

function fixture(id: string): SessionRecord {
  const time = "2026-11-05T00:00:00.000Z";
  return {
    id,
    version: "4",
    title: "회의",
    committeeName: "위원회",
    sourceUrl: "",
    startedAt: time,
    endedAt: null,
    createdAt: time,
    updatedAt: time,
    status: "running",
    subtitleCount: 1,
    charCount: 2,
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [
      {
        id: `${id}_row`,
        text: "원문",
        timestamp: time,
        startTime: time,
        endTime: time,
      },
    ],
  };
}

function storageFixture() {
  const data: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (keys: string | string[] | null) => {
      const selected =
        keys === null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      return structuredClone(
        Object.fromEntries(
          selected.filter((key) => key in data).map((key) => [key, data[key]]),
        ),
      );
    }),
    set: vi.fn(async (values: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      Object.assign(data, structuredClone(values));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
  };
  vi.stubGlobal("chrome", { storage: { local } });
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request<T>(
        name: string,
        _options: unknown,
        task: () => Promise<T>,
      ): Promise<T> {
        const next = (locks.get(name) ?? Promise.resolve()).then(task, task);
        locks.set(
          name,
          next.catch(() => undefined),
        );
        return next;
      },
    },
  });
  return { data, local };
}

describe("storage backend failover and cross-context durability", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    "recovers an unreadable IDB baseline across restart (explicit clear=%s)",
    async (clear) => {
      storageFixture();
      const before = await import("../src/storage/session-store");
      const base = fixture("unreadable_base");
      await before.updateRunningSession(base);
      await before.updateSessionMetadata(base.id, {
        note: "기존 IDB 메모",
        tags: ["유지"],
      });
      await before.updateSessionContent(base.id, {
        entries: [
          { ...base.entries[0], text: "기존 교정", originalText: "원문" },
        ],
      });
      const db = indexedDB;
      vi.stubGlobal("indexedDB", undefined);
      await before.updateRunningSession(base);
      if (clear) await before.updateSessionMetadata(base.id, { note: "" });
      vi.resetModules();
      vi.stubGlobal("indexedDB", db);
      const after = await import("../src/storage/session-store");
      await after.updateRunningSession(base);
      const restored = await after.loadSession(base.id);
      expect(restored).toMatchObject({
        note: clear ? "" : "기존 IDB 메모",
        tags: ["유지"],
      });
      expect(restored?.entries[0]).toMatchObject({
        text: "기존 교정",
        originalText: "원문",
      });
      const exported = await after.exportSessionData(restored!, "json");
      expect(exported.content).not.toContain("unreconciledFallback");
    },
  );

  it("preserves History metadata and entry edits after fallback → IDB recovery", async () => {
    const { data } = storageFixture();
    const store = await import("../src/storage/session-store");
    const base = fixture("recovery");
    await store.updateRunningSession(base);
    const db = indexedDB;
    vi.stubGlobal("indexedDB", undefined);
    await store.updateRunningSession({
      ...base,
      updatedAt: "2026-11-05T00:01:00.000Z",
    });
    await store.updateSessionMetadata(base.id, {
      note: "보존할 메모",
      tags: ["중요"],
    });
    await store.updateSessionContent(base.id, {
      entries: [
        {
          ...base.entries[0],
          text: "사용자 교정",
          originalText: "원문",
          entryNote: "행 메모",
          labels: ["확인"],
        },
      ],
    });
    vi.stubGlobal("indexedDB", db);
    await store.updateRunningSession({
      ...base,
      updatedAt: new Date(Date.now() + 1000).toISOString(),
      entries: [
        ...base.entries,
        { ...base.entries[0], id: "new", text: "추가 발언" },
      ],
    });
    expect(await store.loadSession(base.id)).toMatchObject({
      note: "보존할 메모",
      tags: ["중요"],
      entries: [
        expect.objectContaining({
          text: "사용자 교정",
          originalText: "원문",
          entryNote: "행 메모",
          labels: ["확인"],
        }),
        expect.objectContaining({ id: "new" }),
      ],
    });
    expect(data[recordKey(base.id)]).toBeUndefined();
  });

  it("preserves IDB edits when a transaction write fails into fallback", async () => {
    storageFixture();
    const store = await import("../src/storage/session-store");
    const base = fixture("write_failure");
    await store.updateRunningSession(base);
    await store.updateSessionMetadata(base.id, { note: "IDB 메모" });
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw new DOMException("disk busy", "UnknownError");
      });
    await store.updateRunningSession({
      ...base,
      updatedAt: new Date().toISOString(),
    });
    put.mockRestore();
    expect((await store.loadSession(base.id))?.note).toBe("IDB 메모");
  });

  it("does not erase an unread fallback copy when storage reads fail", async () => {
    const { data, local } = storageFixture();
    const store = await import("../src/storage/session-store");
    const base = fixture("read_failure");
    await store.updateRunningSession(base);
    data[recordKey(base.id)] = {
      ...base,
      note: "유일한 편집",
      updatedAt: new Date().toISOString(),
    };
    local.get.mockRejectedValue(new Error("storage unavailable"));
    await expect(store.updateRunningSession(base)).rejects.toThrow();
    expect(data[recordKey(base.id)]).toMatchObject({ note: "유일한 편집" });
  });

  it("keeps two independent contexts' different IDs in index, search and backup", async () => {
    const { data } = storageFixture();
    vi.stubGlobal("indexedDB", undefined);
    const a = await import("../src/storage/session-store");
    vi.resetModules();
    const b = await import("../src/storage/session-store");
    await Promise.all([
      a.saveSession(fixture("context_a")),
      b.saveSession(fixture("context_b")),
    ]);
    expect(data[indexKey]).toEqual(
      expect.arrayContaining(["context_a", "context_b"]),
    );
    expect((await b.listSessions()).map((record) => record.id)).toEqual(
      expect.arrayContaining(["context_a", "context_b"]),
    );
    expect(
      (await b.searchSessions({ query: "원문", page: 1, pageSize: 20 }))
        .totalCount,
    ).toBe(2);
    const backup = await b.buildSessionLibraryBackupExport();
    expect(JSON.parse(backup.payload.content).sessions).toHaveLength(2);
  });

  it("rebuilds missing index and stale metadata from durable records", async () => {
    const { data } = storageFixture();
    vi.stubGlobal("indexedDB", undefined);
    const store = await import("../src/storage/session-store");
    data[recordKey("orphan")] = fixture("orphan");
    data[indexKey] = ["missing"];
    data[metadataKey] = { missing: fixture("missing") };
    expect((await store.listSessions()).map((record) => record.id)).toEqual([
      "orphan",
    ]);
    expect(data[indexKey]).toEqual(["orphan"]);
  });

  it("preserves newer migrated keys and serializes a different-ID save/delete", async () => {
    const { data } = storageFixture();
    vi.stubGlobal("indexedDB", undefined);
    const a = await import("../src/storage/session-store");
    vi.resetModules();
    const b = await import("../src/storage/session-store");
    data["assembly-subtitle-session-fallback"] = { legacy: fixture("legacy") };
    data[recordKey("legacy")] = {
      ...fixture("legacy"),
      note: "최신 키",
      updatedAt: "2026-11-05T01:00:00.000Z",
    };
    data[recordKey("durable")] = fixture("durable");
    await Promise.all([a.saveSession(fixture("new")), b.listSessions()]);
    expect((await b.loadSession("legacy"))?.note).toBe("최신 키");
    await Promise.all([
      a.saveSession(fixture("another")),
      b.deleteSession("legacy"),
    ]);
    expect((await a.listSessions()).map((record) => record.id).sort()).toEqual([
      "another",
      "durable",
      "new",
    ]);
  });

  it("rejects a failed IDB deletion and allows a successful retry", async () => {
    storageFixture();
    const store = await import("../src/storage/session-store");
    const base = fixture("delete_failure");
    await store.saveSession(base);
    const remove = vi
      .spyOn(IDBObjectStore.prototype, "delete")
      .mockImplementation(() => {
        throw new DOMException("disk busy", "UnknownError");
      });
    await expect(store.deleteSession(base.id)).rejects.toThrow();
    remove.mockRestore();
    expect(await store.loadSession(base.id)).toBeDefined();
    await store.deleteSession(base.id);
    expect(await store.loadSession(base.id)).toBeUndefined();
  });

  it("keeps a newer fallback version during conditional IDB healing", async () => {
    const { data } = storageFixture();
    const fallback =
      await import("../src/storage/session-store/fallback/storage");
    const base = fixture("newer_copy");
    data[recordKey(base.id)] = {
      ...base,
      updatedAt: "2026-11-05T02:00:00.000Z",
      note: "새 편집",
    };
    await fallback.bestEffortDeleteFallbackRecord(base.id, base.updatedAt);
    expect(data[recordKey(base.id)]).toMatchObject({ note: "새 편집" });
  });

  it("does not expose a successful save when durable storage hits quota", async () => {
    const { data, local } = storageFixture();
    vi.stubGlobal("indexedDB", undefined);
    const store = await import("../src/storage/session-store");
    local.set.mockRejectedValue(new Error("QUOTA_BYTES exceeded"));
    await expect(store.saveSession(fixture("quota"))).rejects.toThrow();
    expect(data[recordKey("quota")]).toBeUndefined();
    local.set.mockImplementation(async (values) => {
      Object.assign(data, structuredClone(values));
    });
    expect(await store.loadSession("quota")).toBeUndefined();
  });

  it("freezes backup membership while records are reordered and added", async () => {
    storageFixture();
    const store = await import("../src/storage/session-store");
    for (const id of ["a", "b", "c"]) await store.saveSession(fixture(id));
    let changed = false;
    const writes: Promise<unknown>[] = [];
    const backup = await store.buildSessionLibraryBackupExport({
      pageSize: 1,
      onProgress: (progress) => {
        if (progress.completed !== 1 || changed) return;
        changed = true;
        writes.push(store.updateSessionMetadata("c", { note: "순서 변경" }));
        writes.push(store.saveSession(fixture("added_later")));
      },
    });
    await Promise.all(writes);
    expect(
      JSON.parse(backup.payload.content)
        .sessions.map((record: SessionRecord) => record.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });
});
