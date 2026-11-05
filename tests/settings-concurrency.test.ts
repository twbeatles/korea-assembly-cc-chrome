import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTENSION_STORAGE_KEY,
  DEFAULT_EXTENSION_SETTINGS,
} from "../src/shared/constants";

function sharedStorage() {
  const data: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string) => structuredClone({ [key]: data[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      Object.assign(data, structuredClone(values));
    }),
  };
  vi.stubGlobal("chrome", { storage: { local } });
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request<T>(name: string, _options: unknown, run: () => Promise<T>) {
        const next = (locks.get(name) ?? Promise.resolve()).then(run, run);
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

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settings durability across extension contexts", () => {
  it("migrates persisted aliases and legacy custom limits without defaults masking them", async () => {
    const { data } = sharedStorage();
    data[EXTENSION_STORAGE_KEY] = {
      exportSpeakerEnabled: true,
      noiseMinLength: 15,
      maxEntriesPerSegment: 3456,
    };
    const store = await import("../src/storage/settings-store");
    expect(await store.getSettings()).toMatchObject({
      txtExportSpeakerEnabled: true,
      recentDuplicateMinLength: 15,
      segmentPreset: "custom",
      maxEntriesPerSegment: 3456,
    });
  });
  it("preserves independent partial changes made by two contexts", async () => {
    const { data } = sharedStorage();
    const a = await import("../src/storage/settings-store");
    vi.resetModules();
    const b = await import("../src/storage/settings-store");
    await Promise.all([
      a.saveSettings({ autoScroll: false }),
      b.saveSettings({ runningAutoSaveEnabled: false }),
    ]);
    expect(data[EXTENSION_STORAGE_KEY]).toMatchObject({
      autoScroll: false,
      runningAutoSaveEnabled: false,
    });
  });

  it("does not commit failed durable writes to the memory fallback", async () => {
    const { local } = sharedStorage();
    const store = await import("../src/storage/settings-store");
    await store.saveSettings({ autoScroll: true });
    local.set.mockRejectedValue(new Error("storage write failed"));
    await expect(store.saveSettings({ autoScroll: false })).rejects.toThrow();
    vi.stubGlobal("chrome", undefined);
    expect((await store.getSettings()).autoScroll).toBe(true);
  });

  it("serializes reset after an already queued save", async () => {
    const { data } = sharedStorage();
    const store = await import("../src/storage/settings-store");
    await Promise.all([
      store.saveSettings({ autoScroll: false }),
      store.resetSettings(),
    ]);
    expect(data[EXTENSION_STORAGE_KEY]).toMatchObject({
      autoScroll: DEFAULT_EXTENSION_SETTINGS.autoScroll,
    });
  });

  it("routes page-origin changes to the extension background storage lock", async () => {
    const { local } = sharedStorage();
    const settings = {
      ...DEFAULT_EXTENSION_SETTINGS,
      txtExportSpeakerEnabled: true,
    };
    const sendMessage = vi.fn((_message, reply) =>
      reply({ ok: true, settings }),
    );
    vi.stubGlobal("chrome", {
      storage: { local },
      runtime: { id: "fixture", sendMessage },
    });
    vi.stubGlobal("window", {
      location: {
        protocol: "https:",
        href: "https://assembly.webcast.go.kr/main/player.asp",
      },
    });
    const store = await import("../src/storage/settings-store");
    expect(
      await store.saveSettings({ txtExportSpeakerEnabled: true }),
    ).toMatchObject({ txtExportSpeakerEnabled: true });
    expect(sendMessage).toHaveBeenCalledWith(
      { type: "UPDATE_SETTINGS", settings: { txtExportSpeakerEnabled: true } },
      expect.any(Function),
    );
    expect(local.set).not.toHaveBeenCalled();
  });
});
