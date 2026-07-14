/**
 * 세션 id 단위 write 직렬화.
 * load-modify-write 경쟁으로 메타/본문 변경이 유실되는 것을 막는다.
 */

const queues = new Map<string, Promise<unknown>>();

export function enqueueSessionWrite<T>(
  sessionId: string,
  task: () => Promise<T>,
): Promise<T> {
  if (!sessionId) {
    return task();
  }

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

/** 테스트 전용 큐 초기화 */
export function resetSessionWriteQueuesForTests(): void {
  queues.clear();
}
