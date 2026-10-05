/**
 * 세션 id 단위 write 직렬화.
 * load-modify-write 경쟁으로 메타/본문 변경이 유실되는 것을 막는다.
 * 확장 문서와 service worker는 메모리를 공유하지 않으므로,
 * 가능하면 Web Locks로 실행 환경 사이에서도 같은 키를 직렬화한다.
 */

interface SessionWriteLockManager {
  request?: (
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<unknown>,
  ) => Promise<unknown>;
}

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
  if (!sessionId) {
    return Promise.reject(new Error("세션 id가 올바르지 않습니다."));
  }
  if (passthroughForTests) {
    return task();
  }

  const locks =
    typeof navigator !== "undefined"
      ? (navigator as unknown as { locks?: SessionWriteLockManager }).locks
      : undefined;

  if (typeof locks?.request === "function") {
    // LockManager.request 는 this 가 LockManager 여야 한다. 메서드를 떼어 호출하면
    // "Illegal invocation" 으로 모든 세션 쓰기가 실패하므로 반드시 locks 에서 직접 호출한다.
    return locks.request(
      `assembly-session-write:${sessionId}`,
      { mode: "exclusive" },
      () => enqueueMemoryQueue(sessionId, task),
    ) as Promise<T>;
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
