import { describe, expect, it } from "vitest";

import type { SessionRecord } from "../src/core/subtitle-models";
import { createSessionExportPayload } from "../src/storage/session-store/export-payload";

function buildSession(): SessionRecord {
  return {
    id: "session_export",
    version: "4",
    title: "본회의",
    committeeName: "본회의",
    sourceUrl: "https://assembly.webcast.go.kr/main/player.asp?xcode=10",
    startedAt: "2026-03-10T09:00:00.000Z",
    endedAt: "2026-03-10T09:00:04.000Z",
    createdAt: "2026-03-10T09:00:00.000Z",
    updatedAt: "2026-03-10T09:00:04.000Z",
    subtitleCount: 1,
    charCount: 5,
    status: "saved",
    starred: false,
    pinnedAt: null,
    note: "",
    entries: [
      {
        id: "subtitle_1",
        text: "안녕하세요",
        timestamp: "2026-03-10T09:00:01.200Z",
        startTime: "2026-03-10T09:00:01.200Z",
        endTime: "2026-03-10T09:00:04.000Z",
        speakerColor: "rgb(35, 124, 147)",
        speakerChannel: "primary",
      },
    ],
  };
}

const identityNormalize = (record: SessionRecord) => record;

describe("createSessionExportPayload speaker options", () => {
  it("includes bracketed speaker prefixes for text formats when enabled", () => {
    const session = buildSession();

    const txt = createSessionExportPayload({
      session,
      format: "txt",
      normalizeSessionRecord: identityNormalize,
      exportOptions: { txtExportSpeakerEnabled: true },
    });
    const srt = createSessionExportPayload({
      session,
      format: "srt",
      normalizeSessionRecord: identityNormalize,
      exportOptions: { txtExportSpeakerEnabled: true },
    });
    const vtt = createSessionExportPayload({
      session,
      format: "vtt",
      normalizeSessionRecord: identityNormalize,
      exportOptions: { txtExportSpeakerEnabled: true },
    });

    expect(txt.content).toContain("[발언자 A] 안녕하세요");
    expect(srt.content).toContain("[발언자 A] 안녕하세요");
    expect(vtt.content).toContain("[발언자 A] 안녕하세요");
  });

  it("omits speaker text for txt/srt/vtt/md/csv when disabled but keeps JSON metadata", () => {
    const session = buildSession();
    const options = { txtExportSpeakerEnabled: false };

    const txt = createSessionExportPayload({
      session,
      format: "txt",
      normalizeSessionRecord: identityNormalize,
      exportOptions: options,
    });
    const md = createSessionExportPayload({
      session,
      format: "md",
      normalizeSessionRecord: identityNormalize,
      exportOptions: options,
    });
    const csv = createSessionExportPayload({
      session,
      format: "csv",
      normalizeSessionRecord: identityNormalize,
      exportOptions: options,
    });
    const json = createSessionExportPayload({
      session,
      format: "json",
      normalizeSessionRecord: identityNormalize,
      exportOptions: options,
    });

    expect(txt.content).toBe("안녕하세요");
    expect(txt.content).not.toContain("발언자");
    expect(md.content).toContain("| 시간 | 내용 | 비고 |");
    expect(md.content).not.toContain("| 시간 | 발언자 | 내용 | 비고 |");
    expect(md.content).not.toContain("발언자 A");
    expect(csv.content).toContain("startTime,endTime,text,highlighted,note,labels");
    expect(csv.content).not.toContain(",speaker,");
    expect(csv.content).not.toContain("발언자 A");
    const parsed = JSON.parse(json.content) as SessionRecord;
    expect(parsed.entries[0]?.speakerChannel).toBe("primary");
    expect(parsed.entries[0]?.speakerColor).toBe("rgb(35, 124, 147)");
  });

  it("fills md/csv speaker cells when enabled", () => {
    const session = buildSession();
    const options = { txtExportSpeakerEnabled: true };

    const md = createSessionExportPayload({
      session,
      format: "md",
      normalizeSessionRecord: identityNormalize,
      exportOptions: options,
    });
    const csv = createSessionExportPayload({
      session,
      format: "csv",
      normalizeSessionRecord: identityNormalize,
      exportOptions: options,
    });

    expect(md.content).toContain("| 시간 | 발언자 | 내용 | 비고 |");
    expect(md.content).toContain("| 발언자 A | 안녕하세요 |");
    expect(csv.content).toContain("startTime,endTime,speaker,text,highlighted,note,labels");
    expect(csv.content).toContain("발언자 A,안녕하세요");
  });
});
