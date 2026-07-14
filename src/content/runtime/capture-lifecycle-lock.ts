/**
 * 캡처 라이프사이클(start/stop/clear/save) 직렬화 락.
 * async 구간에서 중복 실행이 겹치지 않도록 단일 큐로 묶는다.
 */

export type CaptureLifecycleAction =
  | "start"
  | "stop"
  | "clear"
  | "save"
  | "save_and_new"
  | "export"
  | "reconcile";

export interface CaptureLifecycleLock {
  run: <T>(action: CaptureLifecycleAction, task: () => Promise<T>) => Promise<T>;
  isBusy: () => boolean;
  getCurrentAction: () => CaptureLifecycleAction | null;
}

export function createCaptureLifecycleLock(): CaptureLifecycleLock {
  let queue: Promise<unknown> = Promise.resolve();
  let depth = 0;
  let currentAction: CaptureLifecycleAction | null = null;

  return {
    run<T>(action: CaptureLifecycleAction, task: () => Promise<T>): Promise<T> {
      const runTask = async (): Promise<T> => {
        depth += 1;
        currentAction = action;
        try {
          return await task();
        } finally {
          depth = Math.max(0, depth - 1);
          if (depth === 0) {
            currentAction = null;
          }
        }
      };

      const next = queue.then(runTask, runTask);
      // 큐 tail은 실패해도 끊기지 않게 유지
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    isBusy(): boolean {
      return depth > 0;
    },
    getCurrentAction(): CaptureLifecycleAction | null {
      return currentAction;
    },
  };
}
