export function isElementVisible(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }

  return element.getClientRects().length > 0;
}
