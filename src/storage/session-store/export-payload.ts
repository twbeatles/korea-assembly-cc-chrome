import { exportJson } from "../../core/exporters/json";
import { normalizeSessionForExport } from "../../core/exporters/normalize-session";
import { exportSrt } from "../../core/exporters/srt";
import { exportTxt } from "../../core/exporters/txt";
import { exportVtt } from "../../core/exporters/vtt";
import {
  withSessionEntries,
  type ExportFormat,
  type SessionRecord,
} from "../../core/subtitle-models";
import { buildExportFilename } from "../../core/timeline";
import type { ExportPayload, SessionExportOptions } from "../types";

interface CreateSessionExportPayloadOptions {
  session: SessionRecord;
  format: ExportFormat;
  normalizeSessionRecord: (
    record: SessionRecord,
    options?: {
      preserveTimestamps?: boolean;
      forceStatus?: SessionRecord["status"];
    },
  ) => SessionRecord;
  exportOptions?: SessionExportOptions;
}

export function createSessionExportPayload(
  options: CreateSessionExportPayloadOptions,
): ExportPayload {
  const {
    session,
    format,
    normalizeSessionRecord,
    exportOptions = {},
  } = options;
  const {
    entries,
    filenamePattern,
    filenameSuffix,
    txtExportTimestampsEnabled = false,
  } = exportOptions;
  const baseSession = entries ? withSessionEntries(session, entries) : session;
  const normalized = normalizeSessionForExport(
    normalizeSessionRecord(baseSession, {
      preserveTimestamps: true,
      forceStatus: baseSession.status,
    }),
  );

  const buildFilename = (): string => {
    const filename = buildExportFilename(normalized, format, filenamePattern);
    const suffix = String(filenameSuffix ?? "").trim();
    if (!suffix) {
      return filename;
    }

    const extension = `.${format}`;
    return filename.endsWith(extension)
      ? `${filename.slice(0, -extension.length)}_${suffix}${extension}`
      : `${filename}_${suffix}`;
  };

  switch (format) {
    case "txt":
      return {
        filename: buildFilename(),
        format,
        mimeType: "text/plain;charset=utf-8",
        content: exportTxt(normalized, {
          includeTimestamps: txtExportTimestampsEnabled,
        }),
      };
    case "srt":
      return {
        filename: buildFilename(),
        format,
        mimeType: "application/x-subrip;charset=utf-8",
        content: exportSrt(normalized),
      };
    case "vtt":
      return {
        filename: buildFilename(),
        format,
        mimeType: "text/vtt;charset=utf-8",
        content: exportVtt(normalized),
      };
    case "json":
      return {
        filename: buildFilename(),
        format,
        mimeType: "application/json;charset=utf-8",
        content: exportJson(normalized),
      };
  }
}
