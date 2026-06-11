import type { SessionRecord } from "../src/core/subtitle-models";
import {
  buildSessionBackupBundle,
  buildSessionBackupFilename,
  parseSessionImportPayload,
  SESSION_BACKUP_KIND,
  SESSION_BACKUP_VERSION,
} from "../src/storage/session-backup";

function buildSession(id: string, updatedAt: string): SessionRecord {
  return {
    id,
    version: "3",
    title: "정무위",
    committeeName: "정무위원회",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: "2026-03-10T09:05:00.000Z",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt,
    subtitleCount: 1,
    charCount: 6,
    status: "saved",
    starred: true,
    pinnedAt: updatedAt,
    note: `${id} 메모`,
    tags: ["예산", "속기"],
    category: "회의록",
    speakerLabels: { primary: "위원장" },
    qualityStats: {
      health: "good",
      entryCount: 1,
      charCount: 6,
      estimatedBytes: 512,
      fallbackOnly: false,
      lastComputedAt: updatedAt,
    },
    lineageId: `${id}_lineage`,
    segmentNumber: 2,
    entries: [
      {
        id: `${id}_entry_1`,
        text: "테스트 자막",
        timestamp: "2026-03-10T09:00:01.000Z",
        startTime: "2026-03-10T09:00:01.000Z",
        endTime: "2026-03-10T09:00:03.000Z",
        sourceFramePath: [0, 1],
      },
    ],
  };
}

describe("session backup helpers", () => {
  it("builds a backup bundle that preserves favorites and notes", () => {
    const exportedAt = "2026-03-12T12:30:45.000Z";
    const bundle = buildSessionBackupBundle([buildSession("session_1", exportedAt)], exportedAt);

    expect(bundle.kind).toBe(SESSION_BACKUP_KIND);
    expect(bundle.version).toBe(SESSION_BACKUP_VERSION);
    expect(bundle.exportedAt).toBe(exportedAt);
    expect(bundle.sessions[0].starred).toBe(true);
    expect(bundle.sessions[0].note).toBe("session_1 메모");
    expect(bundle.sessions[0].tags).toEqual(["예산", "속기"]);
    expect(bundle.sessions[0].category).toBe("회의록");
    expect(bundle.sessions[0].speakerLabels?.primary).toBe("위원장");
    expect(bundle.sessions[0].lineageId).toBe("session_1_lineage");
    expect(bundle.sessions[0].segmentNumber).toBe(2);
    expect(bundle.sessions[0].entries[0].sourceFramePath).toEqual([0, 1]);
  });

  it("parses a single session payload and a bundle payload", () => {
    const single = parseSessionImportPayload(buildSession("session_single", "2026-03-12T12:00:00.000Z"));
    expect(single.records).toHaveLength(1);
    expect(single.invalidCount).toBe(0);

    const bundle = parseSessionImportPayload({
      kind: SESSION_BACKUP_KIND,
      version: SESSION_BACKUP_VERSION,
      exportedAt: "2026-03-12T12:30:45.000Z",
      sessions: [
        buildSession("session_valid", "2026-03-12T12:00:00.000Z"),
        { broken: true },
      ],
    });

    expect(bundle.records).toHaveLength(1);
    expect(bundle.records[0].id).toBe("session_valid");
    expect(bundle.records[0].tags).toEqual(["예산", "속기"]);
    expect(bundle.records[0].category).toBe("회의록");
    expect(bundle.records[0].speakerLabels?.primary).toBe("위원장");
    expect(bundle.records[0].lineageId).toBe("session_valid_lineage");
    expect(bundle.records[0].segmentNumber).toBe(2);
    expect(bundle.invalidCount).toBe(1);
  });

  it("drops unknown fields while preserving supported session metadata", () => {
    const parsed = parseSessionImportPayload({
      ...buildSession("session_unknown_field", "2026-03-12T12:00:00.000Z"),
      injected: "drop me",
      entries: [
        {
          ...buildSession("session_unknown_field", "2026-03-12T12:00:00.000Z").entries[0],
          extraEntryField: "drop me too",
        },
      ],
    });

    expect(parsed.records[0]).not.toHaveProperty("injected");
    expect(parsed.records[0].entries[0]).not.toHaveProperty("extraEntryField");
  });

  it("rejects unsupported JSON shapes", () => {
    expect(() => parseSessionImportPayload({ sessions: [] })).toThrow(
      "가져온 JSON 형식이 올바르지 않습니다.",
    );
  });

  it("treats empty session ids as invalid import records", () => {
    const parsed = parseSessionImportPayload({
      kind: SESSION_BACKUP_KIND,
      version: SESSION_BACKUP_VERSION,
      exportedAt: "2026-03-12T12:30:45.000Z",
      sessions: [
        buildSession("session_valid", "2026-03-12T12:00:00.000Z"),
        {
          ...buildSession("session_empty", "2026-03-12T12:00:00.000Z"),
          id: "",
        },
        {
          ...buildSession("session_blank", "2026-03-12T12:00:00.000Z"),
          id: "   ",
        },
      ],
    });

    expect(parsed.records.map((record) => record.id)).toEqual(["session_valid"]);
    expect(parsed.invalidCount).toBe(2);
  });

  it("rejects unsupported backup versions and invalid timestamps", () => {
    expect(() =>
      parseSessionImportPayload({
        kind: SESSION_BACKUP_KIND,
        version: "999",
        exportedAt: "2026-03-12T12:30:45.000Z",
        sessions: [buildSession("session_invalid_version", "2026-03-12T12:00:00.000Z")],
      }),
    ).toThrow("가져온 JSON 형식이 올바르지 않습니다.");

    expect(() =>
      parseSessionImportPayload({
        ...buildSession("session_invalid_time", "2026-03-12T12:00:00.000Z"),
        updatedAt: "not-a-date",
      }),
    ).toThrow("가져온 JSON 형식이 올바르지 않습니다.");
  });

  it("normalizes unsupported source urls to an empty string", () => {
    const parsed = parseSessionImportPayload({
      ...buildSession("session_invalid_source", "2026-03-12T12:00:00.000Z"),
      sourceUrl: "https://example.com/not-supported",
    });

    expect(parsed.records[0].sourceUrl).toBe("");
  });

  it("builds a timestamped backup filename", () => {
    const filename = buildSessionBackupFilename(new Date(2026, 2, 12, 12, 30, 45));
    expect(filename).toBe("assembly_subtitle_backup_20260312_123045.json");
  });
});
