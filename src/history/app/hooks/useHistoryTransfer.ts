import { useEffect, useRef, useState } from "react";

import { createTab, sendRuntimeMessage } from "../../../shared/chrome-api";
import { copyTextToClipboard } from "../../../shared/copy-utils";
import type {
  ExportFormat,
  SessionRecord,
} from "../../../core/subtitle-models";
import { sortSessionSegments } from "../../../core/session-lineage";
import {
  mapDownloadErrorMessage,
  resolveDownloadErrorMessage,
} from "../../../shared/download-errors";
import {
  assertSessionLibraryTransferSizeWithinLimit,
  parseSessionImportPayload,
} from "../../../storage/session-backup";
import { getUtf8ByteLength } from "../../../shared/byte-size";
import {
  buildSessionLibraryBackupExport,
  importSessionRecords,
} from "../../../storage/session-store";
import { buildSessionImportMessage } from "../../history-view-state";
import type {
  SessionLongTaskKind,
  SessionLongTaskProgress,
} from "../../../storage/types";
import { getExportFormatLabel } from "../../../shared/ui-labels";
import { readBlobTextWithProgress } from "../../blob-read";
import { downloadPageBlobExport } from "../../page-blob-download";
import {
  canReopenSourceUrl,
  extractCancelledImportSummary,
  isAbortError,
} from "../helpers";
import { useHistoryLongTask } from "./useHistoryLongTask";

interface HistoryTransferDeps {
  selectedSession: SessionRecord | null;
  displaySession: SessionRecord | null;
  selectedLineageId: string;
  availableLineageSessions: SessionRecord[];
  showingLineageView: boolean;
  filenamePattern: string;
  txtExportTimestampsEnabled: boolean;
  txtExportSpeakerEnabled: boolean;
  isBusy: () => boolean;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  requestRefresh: (
    messageOnSuccess?: string,
    options?: { preserveMessage?: boolean },
  ) => void;
}

/**
 * 내보내기·가져오기 도메인 (단일 책임: 파일 입출력과 장기 작업).
 */
export function useHistoryTransfer({
  selectedSession,
  displaySession,
  selectedLineageId,
  availableLineageSessions,
  showingLineageView,
  filenamePattern,
  txtExportTimestampsEnabled,
  txtExportSpeakerEnabled,
  isBusy,
  setMessage,
  requestRefresh,
}: HistoryTransferDeps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const longTaskAbortControllerRef = useRef<AbortController | null>(null);
  const {
    longTask,
    beginLongTask,
    updateLongTaskProgress: applyLongTaskProgress,
    requestLongTaskCancel,
    endLongTask,
  } = useHistoryLongTask();
  /** 시간 범위 export (datetime-local 값, 비우면 전체) */
  const [exportTimeFrom, setExportTimeFrom] = useState("");
  const [exportTimeTo, setExportTimeTo] = useState("");

  const updateLongTaskProgress = (progress: SessionLongTaskProgress): void => {
    applyLongTaskProgress(progress);
  };

  const clearLongTaskState = (
    _kind: SessionLongTaskKind,
    controller: AbortController,
  ): void => {
    if (longTaskAbortControllerRef.current === controller) {
      longTaskAbortControllerRef.current = null;
    }
    // longTask 클로저 스테일에 의존하지 않고 항상 종료
    endLongTask();
  };

  const handleCancelLongTask = (): void => {
    if (!longTaskAbortControllerRef.current || !longTask || longTask.cancelRequested) {
      return;
    }
    requestLongTaskCancel();
  };

  useEffect(
    () => () => {
      longTaskAbortControllerRef.current?.abort();
      longTaskAbortControllerRef.current = null;
    },
    [],
  );

  const handleReopen = async (): Promise<void> => {
    if (!canReopenSourceUrl(selectedSession?.sourceUrl)) {
      setMessage("지원되는 원본 의사중계 URL이 없습니다.");
      return;
    }

    try {
      await createTab(selectedSession.sourceUrl);
      setMessage("원본 의사중계 페이지를 새 탭으로 열었습니다.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "원본 페이지를 열지 못했습니다.",
      );
    }
  };

  const resolveExportTimeRange = ():
    | { from?: string; to?: string }
    | undefined => {
    const fromLocal = exportTimeFrom.trim();
    const toLocal = exportTimeTo.trim();
    if (!fromLocal && !toLocal) {
      return undefined;
    }
    // datetime-local 은 로컬 시각 문자열이므로 Date 로 파싱해 ISO 로 보낸다.
    const fromIso = fromLocal ? new Date(fromLocal).toISOString() : undefined;
    const toIso = toLocal ? new Date(toLocal).toISOString() : undefined;
    if (fromIso && Number.isNaN(Date.parse(fromIso))) {
      throw new Error("시작 시각 형식이 올바르지 않습니다.");
    }
    if (toIso && Number.isNaN(Date.parse(toIso))) {
      throw new Error("종료 시각 형식이 올바르지 않습니다.");
    }
    return { from: fromIso, to: toIso };
  };

  const handleExport = async (
    format: ExportFormat,
    entries?: SessionRecord["entries"],
  ): Promise<void> => {
    if (!selectedSession || !displaySession) {
      return;
    }

    const isPartialExport = Boolean(entries?.length);
    let timeRange: { from?: string; to?: string } | undefined;
    try {
      timeRange = resolveExportTimeRange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "시간 범위가 올바르지 않습니다.");
      return;
    }

    try {
      const response = showingLineageView
        ? await sendRuntimeMessage({
            type: "DOWNLOAD_SESSION_LINEAGE_EXPORT",
            lineageId: selectedLineageId,
            format,
            filenamePattern,
            txtExportTimestampsEnabled,
            txtExportSpeakerEnabled,
            entryIds: entries?.map((entry) => entry.id),
            timeRange,
          })
        : await sendRuntimeMessage({
            type: "DOWNLOAD_SESSION_EXPORT",
            sessionId: selectedSession.id,
            format,
            filenamePattern,
            txtExportTimestampsEnabled,
            txtExportSpeakerEnabled,
            entryIds: entries?.map((entry) => entry.id),
            timeRange,
          });
      if (!response.ok) {
        setMessage(
          mapDownloadErrorMessage(
            response.error,
            isPartialExport ? "partial" : "single-session",
          ) || "파일 저장을 시작하지 못했습니다.",
        );
        return;
      }

      if (entries?.length) {
        setMessage(
          `${
            showingLineageView ? "연속 캡처 전체에서 " : ""
          }선택한 ${entries.length}줄 ${getExportFormatLabel(format)} 저장을 시작했습니다.`,
        );
        return;
      }

      setMessage(
        showingLineageView
          ? `연속 캡처 전체 ${getExportFormatLabel(format)} 저장을 시작했습니다.`
          : `${getExportFormatLabel(format)} 파일 저장을 시작했습니다.`,
      );
    } catch (error) {
      setMessage(
        resolveDownloadErrorMessage(
          error,
          "파일 저장을 시작하지 못했습니다.",
          entries?.length ? "partial" : "single-session",
        ),
      );
    }
  };

  const handleSplitLineageExport = async (format: ExportFormat): Promise<void> => {
    if (!selectedLineageId || availableLineageSessions.length <= 1) {
      return;
    }

    try {
      const segments = sortSessionSegments(availableLineageSessions);
      for (const [index, segment] of segments.entries()) {
        const response = await sendRuntimeMessage({
          type: "DOWNLOAD_SESSION_EXPORT",
          sessionId: segment.id,
          format,
          filenamePattern,
          txtExportTimestampsEnabled,
          txtExportSpeakerEnabled,
          filenameSuffix: `segment-${String(index + 1).padStart(3, "0")}`,
        });
        if (!response.ok) {
          setMessage(
            mapDownloadErrorMessage(response.error) ||
              `세그먼트 ${index + 1} 저장을 시작하지 못했습니다.`,
          );
          return;
        }
      }

      setMessage(
        `연속 캡처 ${segments.length}개 세그먼트의 ${getExportFormatLabel(format)} 분할 저장을 시작했습니다.`,
      );
    } catch (error) {
      setMessage(resolveDownloadErrorMessage(error, "분할 저장을 시작하지 못했습니다."));
    }
  };

  const handleCopy = async (text: string, label: string): Promise<void> => {
    try {
      await copyTextToClipboard(text);
      setMessage(label);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "텍스트 복사에 실패했습니다.",
      );
    }
  };

  const handleBackupAll = async (): Promise<void> => {
    const controller = beginLongTask(
      "backup",
      "전체 JSON 백업을 준비하고 있습니다.",
    );
    longTaskAbortControllerRef.current = controller;

    try {
      const backupExport = await buildSessionLibraryBackupExport({
        signal: controller.signal,
        onProgress: updateLongTaskProgress,
      });
      if (!backupExport.sessionCount) {
        setMessage("백업할 기록이 없습니다.");
        return;
      }

      updateLongTaskProgress({
        kind: "backup",
        phase: "download",
        completed: backupExport.sessionCount,
        total: backupExport.sessionCount,
        message: `전체 JSON 백업 다운로드를 준비하고 있습니다. (${backupExport.sessionCount} / ${backupExport.sessionCount})`,
      });
      if (controller.signal.aborted) {
        setMessage("전체 JSON 백업을 취소했습니다.");
        return;
      }

      await downloadPageBlobExport(backupExport.payload);

      setMessage(
        `저장된 기록 ${backupExport.sessionCount}건의 JSON 백업을 시작했습니다.`,
      );
    } catch (error) {
      if (isAbortError(error)) {
        setMessage("전체 JSON 백업을 취소했습니다.");
        return;
      }

      setMessage(
        resolveDownloadErrorMessage(
          error,
          "전체 JSON 백업에 실패했습니다.",
          "library",
        ),
      );
    } finally {
      clearLongTaskState("backup", controller);
    }
  };

  const jsonTaskLocked = (): boolean => isBusy() || longTask !== null;

  const handleImportClick = (): void => {
    if (jsonTaskLocked()) {
      return;
    }

    importInputRef.current?.click();
  };

  const handleImportChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || jsonTaskLocked()) {
      return;
    }

    const controller = beginLongTask("import", "JSON 파일을 읽고 있습니다.");
    longTaskAbortControllerRef.current = controller;
    let invalidCount = 0;

    try {
      assertSessionLibraryTransferSizeWithinLimit(file.size, "JSON 가져오기");
      const fileText = await readBlobTextWithProgress(file, {
        signal: controller.signal,
        onProgress: ({ completed, total }) => {
          updateLongTaskProgress({
            kind: "import",
            phase: "read",
            completed,
            total,
            message: total
              ? `JSON 파일을 읽고 있습니다. (${completed} / ${total})`
              : "JSON 파일을 읽고 있습니다.",
          });
        },
      });
      assertSessionLibraryTransferSizeWithinLimit(
        getUtf8ByteLength(fileText),
        "JSON 가져오기",
      );

      updateLongTaskProgress({
        kind: "import",
        phase: "parse",
        completed: 0,
        total: 0,
        message: "JSON 내용을 해석하고 있습니다.",
      });
      const parsed = JSON.parse(fileText) as unknown;
      if (controller.signal.aborted) {
        setMessage("JSON 가져오기를 취소했습니다.");
        return;
      }

      updateLongTaskProgress({
        kind: "import",
        phase: "sanitize",
        completed: 0,
        total: 0,
        message: "가져올 기록을 정리하고 있습니다.",
      });
      const importPayload = parseSessionImportPayload(parsed);
      invalidCount = importPayload.invalidCount;
      if (!importPayload.records.length && importPayload.invalidCount === 0) {
        setMessage("가져올 기록이 없습니다.");
        return;
      }

      const summary = await importSessionRecords(importPayload.records, {
        signal: controller.signal,
        onProgress: updateLongTaskProgress,
      });
      requestRefresh(
        buildSessionImportMessage({
          ...summary,
          invalidCount: importPayload.invalidCount,
        }),
      );
    } catch (error) {
      if (isAbortError(error)) {
        const cancelledSummary = extractCancelledImportSummary(error);
        const cancelledSummaryData = cancelledSummary ?? {
          addedCount: 0,
          updatedCount: 0,
          keptCount: 0,
          failedCount: 0,
        };
        const hasMeaningfulCancelledSummary =
          cancelledSummaryData.addedCount > 0 ||
          cancelledSummaryData.updatedCount > 0 ||
          cancelledSummaryData.keptCount > 0 ||
          cancelledSummaryData.failedCount > 0 ||
          invalidCount > 0;

        if (!hasMeaningfulCancelledSummary) {
          setMessage("JSON 가져오기를 취소했습니다.");
          return;
        }

        const cancelledMessage = buildSessionImportMessage({
          ...cancelledSummaryData,
          invalidCount,
          cancelled: true,
        });

        if (
          cancelledSummaryData.addedCount > 0 ||
          cancelledSummaryData.updatedCount > 0
        ) {
          requestRefresh(cancelledMessage);
        } else {
          setMessage(cancelledMessage);
        }
        return;
      }

      setMessage(
        error instanceof Error
          ? error.message
          : "JSON 가져오기에 실패했습니다.",
      );
    } finally {
      clearLongTaskState("import", controller);
    }
  };

  return {
    importInputRef,
    longTask,
    exportTimeFrom,
    setExportTimeFrom,
    exportTimeTo,
    setExportTimeTo,
    handleReopen,
    handleExport,
    handleSplitLineageExport,
    handleCopy,
    handleBackupAll,
    handleImportClick,
    handleImportChange,
    handleCancelLongTask,
  };
}
