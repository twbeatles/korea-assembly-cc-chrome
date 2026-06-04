export const DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX = 20;

export function enqueueBoundedSegmentEvent<T>(
  queue: T[],
  event: T,
  maxSize = DEFAULT_SEGMENT_ROLLOVER_EVENT_QUEUE_MAX,
): T[] {
  const safeMaxSize = Math.max(1, Math.floor(maxSize));
  const nextQueue = [...queue, event];
  return nextQueue.length > safeMaxSize ? nextQueue.slice(-safeMaxSize) : nextQueue;
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
