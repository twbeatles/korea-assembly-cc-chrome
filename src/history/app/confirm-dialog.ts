/**
 * History 파괴적 확인용 accessible dialog.
 * unit test(Vitest) 에서는 기존 window.confirm 스파이 호환을 유지한다.
 */

export interface ConfirmDestructiveOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

function isTestEnvironment(): boolean {
  try {
    return Boolean(
      (import.meta as ImportMeta & { env?: { MODE?: string; VITEST?: boolean } }).env?.VITEST ||
        (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE === "test",
    );
  } catch {
    return false;
  }
}

function showAccessibleConfirmDialog(
  message: string,
  options: ConfirmDestructiveOptions = {},
): Promise<boolean> {
  const title = options.title ?? "확인";
  const confirmLabel = options.confirmLabel ?? "확인";
  const cancelLabel = options.cancelLabel ?? "취소";

  return new Promise((resolve) => {
    const previousActive = document.activeElement as HTMLElement | null;
    const overlay = document.createElement("div");
    overlay.className = "confirm-dialog-overlay";
    overlay.setAttribute("role", "presentation");

    const dialog = document.createElement("div");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "confirm-dialog-title");
    dialog.setAttribute("aria-describedby", "confirm-dialog-message");

    const heading = document.createElement("h2");
    heading.id = "confirm-dialog-title";
    heading.className = "confirm-dialog-title";
    heading.textContent = title;

    const body = document.createElement("p");
    body.id = "confirm-dialog-message";
    body.className = "confirm-dialog-message";
    body.textContent = message;

    const actions = document.createElement("div");
    actions.className = "confirm-dialog-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary";
    cancelButton.textContent = cancelLabel;

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.textContent = confirmLabel;

    const cleanup = (result: boolean): void => {
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      previousActive?.focus?.();
      resolve(result);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(false);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = [cancelButton, confirmButton];
      const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
      if (event.shiftKey) {
        const next = currentIndex <= 0 ? focusable[focusable.length - 1] : focusable[currentIndex - 1];
        event.preventDefault();
        next.focus();
        return;
      }
      const next = currentIndex >= focusable.length - 1 ? focusable[0] : focusable[currentIndex + 1];
      event.preventDefault();
      next.focus();
    };

    cancelButton.addEventListener("click", () => cleanup(false));
    confirmButton.addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        cleanup(false);
      }
    });

    actions.append(cancelButton, confirmButton);
    dialog.append(heading, body, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    document.addEventListener("keydown", onKeyDown, true);
    confirmButton.focus();
  });
}

/**
 * 파괴적 동작 확인. production 은 accessible dialog, test 는 window.confirm.
 */
export async function confirmDestructiveAction(
  message: string,
  options: ConfirmDestructiveOptions = {},
): Promise<boolean> {
  if (typeof window === "undefined") {
    return true;
  }

  if (isTestEnvironment()) {
    if (typeof window.confirm === "function") {
      return window.confirm(message);
    }
    return true;
  }

  if (!document.body) {
    if (typeof window.confirm === "function") {
      return window.confirm(message);
    }
    return true;
  }

  return showAccessibleConfirmDialog(message, options);
}
