import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetExtensionContextInvalidationForTests } from "../src/shared/extension-context";
import {
  loadSession,
  resetSessionStoreForTests,
  saveSession,
  updateRunningSession,
  updateSessionMetadata,
} from "../src/storage/session-store";
import { setSessionWriteQueuePassthroughForTests } from "../src/storage/session-write-queue";
import type { SessionRecord } from "../src/core/subtitle-models";

function buildSession(id: string): SessionRecord {
  return {
    id,
    version: "4",
    title: "법사위",
    committeeName: "법제사법위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: "2026-03-10T09:00:03.000Z",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt: "2026-03-10T09:00:03.000Z",
    subtitleCount: 1,
    charCount: 8,
    status: "saved",
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [
      {
        id: `${id}_entry`,
        text: "테스트 자막",
        timestamp: "2026-03-10T09:00:00.000Z",
        startTime: "2026-03-10T09:00:00.000Z",
        endTime: "2026-03-10T09:00:02.000Z",
      },
    ],
  };
}

describe("session store cross-context writes", () => {
  beforeEach(async () => {
    resetExtensionContextInvalidationForTests();
    await resetSessionStoreForTests();
    setSessionWriteQueuePassthroughForTests(true);
  });

  afterEach(async () => {
    setSessionWriteQueuePassthroughForTests(false);
    await resetSessionStoreForTests();
  });

  it("keeps independent metadata patches when two writers skip the in-memory queue", async () => {
    await saveSession(buildSession("session_dual_meta"));

    await Promise.all([
      updateSessionMetadata("session_dual_meta", { note: "retained note" }),
      updateSessionMetadata("session_dual_meta", { starred: true }),
    ]);

    const loaded = await loadSession("session_dual_meta");
    expect(loaded?.note).toBe("retained note");
    expect(loaded?.starred).toBe(true);
  });

  it("keeps a metadata note when a concurrent autosave adds a new entry", async () => {
    const original = await updateRunningSession({
      ...buildSession("session_dual_autosave"),
      status: "running",
      endedAt: null,
    });

    await Promise.all([
      updateSessionMetadata(original.id, { note: "keep this note" }),
      updateRunningSession({
        ...original,
        entries: [
          ...original.entries,
          {
            id: "session_dual_autosave_e2",
            text: "new captured row",
            timestamp: "2026-03-10T09:00:04.000Z",
            startTime: "2026-03-10T09:00:04.000Z",
            endTime: "2026-03-10T09:00:05.000Z",
          },
        ],
        subtitleCount: 2,
        charCount: original.charCount + "new captured row".length,
        updatedAt: "2026-03-10T09:00:05.000Z",
      }),
    ]);

    const loaded = await loadSession(original.id);
    expect(loaded?.note).toBe("keep this note");
    expect(loaded?.entries.map((entry) => entry.id)).toEqual([
      original.entries[0].id,
      "session_dual_autosave_e2",
    ]);
  });
});
