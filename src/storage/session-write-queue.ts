/**
 * 세션 id 단위 write 직렬화.
 * load-modify-write 경쟁으로 메타/본문 변경이 유실되는 것을 막는다.
 * 확장 문서와 service worker는 메모리를 공유하지 않으므로,
 * 가능하면 Web Locks로 실행 환경 사이에서도 같은 키를 직렬화한다.
 */

const queues = new Map<string, Promise<unknown>>();
let passthroughForTests = false;

function enqueueMemoryQueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    sessionId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export function enqueueSessionWrite<T>(
  sessionId: string,
  task: () => Promise<T>,
): Promise<T> {
  if (!sessionId || passthroughForTests) {
    return task();
  }

  const nav =
    typeof navigator !== "undefined"
      ? (navigator as unknown as { locks?: { request?: unknown } })
      : undefined;
  const lockRequest = (
    typeof nav?.locks?.request === "function" ? nav.locks.request : undefined
  ) as
    | ((
        name: string,
        options: { mode: "exclusive" },
        callback: () => Promise<T>,
      ) => Promise<T>)
    | undefined;

  if (lockRequest) {
    return lockRequest(`assembly-session-write:${sessionId}`, { mode: "exclusive" }, () =>
      enqueueMemoryQueue(sessionId, task),
    );
  }

  return enqueueMemoryQueue(sessionId, task);
}

/** 테스트 전용: 실행 환경이 다른 것처럼 in-memory 큐를 건너뛴다. */
export function setSessionWriteQueuePassthroughForTests(enabled: boolean): void {
  passthroughForTests = enabled;
}

/** 테스트 전용 큐 초기화 */
export function resetSessionWriteQueuesForTests(): void {
  queues.clear();
  passthroughForTests = false;
}
