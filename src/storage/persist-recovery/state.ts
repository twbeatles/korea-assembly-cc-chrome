import type { PersistReplayDiagnostics, QueuedExitPersistRecord } from "../types";
import { createEmptyPersistReplayDiagnostics } from "./sanitize";

/** 메모리 큐·tombstone·진단 스냅샷과 인덱스 뮤테이션 직렬화 큐 (단일 책임: 휘발성 상태). */
export const memoryQueuedRecords = new Map<string, QueuedExitPersistRecord>();

export const memoryDeletedSessionTombstones = new Map<string, string>();

export let memoryDiagnostics = createEmptyPersistReplayDiagnostics();

/** 인덱스 read-modify-write 를 탭/호출 간에 직렬화한다. */
export let exitPersistIndexMutationQueue: Promise<unknown> = Promise.resolve();

export function enqueueExitPersistIndexMutation<T>(task: () => Promise<T>): Promise<T> {
  const next = exitPersistIndexMutationQueue.then(task, task);
  exitPersistIndexMutationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function resetPersistRecoveryMemoryForTests(): void {
  memoryQueuedRecords.clear();
  memoryDiagnostics = createEmptyPersistReplayDiagnostics();
  exitPersistIndexMutationQueue = Promise.resolve();
  memoryDeletedSessionTombstones.clear();
}

export function setMemoryDiagnostics(next: PersistReplayDiagnostics): void {
  memoryDiagnostics = next;
}
