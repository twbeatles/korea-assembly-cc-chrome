const SCROLL_FOLLOW_THRESHOLD_PX = 24;

function getScrollBottomDistance(container: HTMLElement): number {
  return Math.max(
    container.scrollHeight - container.clientHeight - container.scrollTop,
    0,
  );
}

export function isScrollNearBottom(
  container: HTMLElement,
  threshold = SCROLL_FOLLOW_THRESHOLD_PX,
): boolean {
  return getScrollBottomDistance(container) <= threshold;
}

export function scrollToBottom(container: HTMLElement): void {
  container.scrollTop = container.scrollHeight;
}
