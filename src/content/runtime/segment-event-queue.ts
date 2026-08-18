/**
 * 롤오버 persist 지연 중 이벤트를 버퍼링하는 상한.
 * 진단/경고 기준은 128, 실제 폐기는 안전 상한에서만 한다.
 */
export const DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX = 128;
/** persist 중 드롭을 줄이기 위한 안전 상한. 이 값을 넘을 때만 가장 오래된 이벤트를 버린다. */
export const SEGMENT_ROLLOVER_EVENT_QUEUE_SAFETY_MAX = 2048;

export interface SegmentEventEnqueueResult<T> {
  queue: T[];
  droppedCount: number;
}

export function enqueueBoundedSegmentEvent<T>(
  queue: T[],
  event: T,
  maxSize = DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX,
): SegmentEventEnqueueResult<T> {
  const safeMaxSize = Math.max(1, Math.floor(maxSize));
  const nextQueue = [...queue, event];
  if (nextQueue.length <= safeMaxSize) {
    return { queue: nextQueue, droppedCount: 0 };
  }
  const droppedCount = nextQueue.length - safeMaxSize;
  return {
    queue: nextQueue.slice(-safeMaxSize),
    droppedCount,
  };
}

export function drainSegmentEventQueue<T>(
  queue: T[],
  handleEvent: (event: T) => boolean,
): T[] {
  const remaining = [...queue];
  while (remaining.length > 0) {
    const event = remaining.shift()!;
    if (!handleEvent(event)) {
      return remaining;
    }
  }
  return remaining;
}
