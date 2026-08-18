/**
 * 파괴적 동작용 accessible alertdialog.
 * History·in-page 패널이 같이 쓴다. Vitest 는 window.confirm 스파이 호환.
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

const DIALOG_STYLE = `
.assembly-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 42, 74, 0.45);
}
.assembly-confirm-dialog {
  width: min(420px, 100%);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 24px 64px rgba(15, 42, 74, 0.28);
  padding: 20px 22px 16px;
  color: #122033;
  font-family: inherit;
}
.assembly-confirm-title {
  margin: 0 0 10px;
  font-size: 1.1rem;
}
.assembly-confirm-message {
  margin: 0 0 18px;
  white-space: pre-wrap;
  line-height: 1.5;
  color: #334155;
  font-size: 0.95rem;
}
.assembly-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.assembly-confirm-actions button {
  border: 0;
  border-radius: 10px;
  padding: 8px 14px;
  font: inherit;
  cursor: pointer;
}
.assembly-confirm-actions .secondary {
  background: #eef2f8;
  color: #122033;
}
.assembly-confirm-actions .primary {
  background: #1d4ed8;
  color: #fff;
}
`;

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
    overlay.className = "assembly-confirm-overlay";
    overlay.setAttribute("role", "presentation");

    const style = document.createElement("style");
    style.textContent = DIALOG_STYLE;

    const dialog = document.createElement("div");
    dialog.className = "assembly-confirm-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "assembly-confirm-title");
    dialog.setAttribute("aria-describedby", "assembly-confirm-message");

    const heading = document.createElement("h2");
    heading.id = "assembly-confirm-title";
    heading.className = "assembly-confirm-title";
    heading.textContent = title;

    const body = document.createElement("p");
    body.id = "assembly-confirm-message";
    body.className = "assembly-confirm-message";
    body.textContent = message;

    const actions = document.createElement("div");
    actions.className = "assembly-confirm-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary";
    cancelButton.textContent = cancelLabel;

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "primary";
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
        next?.focus();
        return;
      }
      const next = currentIndex >= focusable.length - 1 ? focusable[0] : focusable[currentIndex + 1];
      event.preventDefault();
      next?.focus();
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
    overlay.append(style, dialog);
    document.body.append(overlay);
    document.addEventListener("keydown", onKeyDown, true);
    confirmButton.focus();
  });
}

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
