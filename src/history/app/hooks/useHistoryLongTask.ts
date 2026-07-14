/**
 * History JSON 백업/가져오기 장기 작업 상태 훅
 */
import { useRef, useState } from "react";

import type { SessionLongTaskKind, SessionLongTaskProgress } from "../../../storage/types";
import type { HistoryLongTaskState } from "../helpers";

export function useHistoryLongTask() {
  const [longTask, setLongTask] = useState<HistoryLongTaskState | null>(null);
  const longTaskAbortRef = useRef<AbortController | null>(null);

  const beginLongTask = (
    kind: SessionLongTaskKind,
    message: string,
    phase = kind === "import" ? "read" : "prepare",
  ): AbortController => {
    longTaskAbortRef.current?.abort();
    const controller = new AbortController();
    longTaskAbortRef.current = controller;
    setLongTask({
      kind,
      phase,
      completed: 0,
      total: 0,
      message,
      cancellable: true,
      cancelRequested: false,
    });
    return controller;
  };

  const updateLongTaskProgress = (progress: SessionLongTaskProgress): void => {
    // beginLongTask 직후 동기 progress 호출 시 stale null 이어도 상태를 만든다.
    setLongTask((current) => {
      if (!current || current.kind !== progress.kind) {
        return {
          ...progress,
          cancellable: true,
          cancelRequested: false,
        };
      }
      return {
        ...current,
        phase: progress.phase,
        completed: progress.completed,
        total: progress.total,
        message: progress.message,
      };
    });
  };

  const requestLongTaskCancel = (): void => {
    // 메시지는 변경하지 않는다 — 완료/취소 최종 문구는 핸들러 setMessage 가 담당.
    setLongTask((current) =>
      current
        ? {
            ...current,
            cancelRequested: true,
          }
        : current,
    );
    longTaskAbortRef.current?.abort();
  };

  const endLongTask = (): void => {
    longTaskAbortRef.current = null;
    setLongTask(null);
  };

  return {
    longTask,
    beginLongTask,
    updateLongTaskProgress,
    requestLongTaskCancel,
    endLongTask,
  };
}
