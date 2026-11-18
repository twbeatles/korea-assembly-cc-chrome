/**
 * History 파괴적 확인. 네이티브 <dialog> 기반.
 *
 * content-script/인페이지 패널은 호스트 페이지 전체를 inert 하게 만들지 않기 위해
 * 공유 커스텀 오버레이(src/shared/accessible-confirm.ts)를 계속 쓴다.
 * History 는 확장 자체 페이지라 네이티브 모달을 쓰고 Esc·포커스 복원을 브라우저에 위임한다.
 */
import type { ConfirmDestructiveOptions } from "../../shared/accessible-confirm";

export type { ConfirmDestructiveOptions } from "../../shared/accessible-confirm";

function isTestEnvironment(): boolean {
  try {
    return Boolean(
      (
        import.meta as ImportMeta & {
          env?: { MODE?: string; VITEST?: boolean };
        }
      ).env?.VITEST ||
      (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE ===
        "test",
    );
  } catch {
    return false;
  }
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

  return showNativeConfirmDialog(message, options);
}

/**
 * 네이티브 모달 확인. 테스트에서 직접 호출할 수 있도록 환경 분기 밖에 둔다.
 * - method="dialog" 폼: 버튼 값이 returnValue 가 된다.
 * - closedby="any": 바깥 클릭 닫기 (미지원 브라우저에서는 Esc만 동작하는 점진 향상).
 * - 초기 포커스는 안전 동작(취소)에 둔다.
 */
export function showNativeConfirmDialog(
  message: string,
  options: ConfirmDestructiveOptions = {},
): Promise<boolean> {
  const title = options.title ?? "확인";
  const confirmLabel = options.confirmLabel ?? "확인";
  const cancelLabel = options.cancelLabel ?? "취소";

  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("closedby", "any");
    dialog.setAttribute("aria-labelledby", "history-confirm-title");

    const heading = document.createElement("h2");
    heading.id = "history-confirm-title";
    heading.className = "confirm-dialog-title";
    heading.textContent = title;

    const body = document.createElement("p");
    body.className = "confirm-dialog-message";
    body.textContent = message;

    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "confirm-dialog-actions";

    const cancelButton = document.createElement("button");
    cancelButton.value = "cancel";
    cancelButton.className = "secondary";
    cancelButton.textContent = cancelLabel;
    cancelButton.autofocus = true;

    const confirmButton = document.createElement("button");
    confirmButton.value = "confirm";
    confirmButton.textContent = confirmLabel;

    dialog.addEventListener(
      "close",
      () => {
        const confirmed = dialog.returnValue === "confirm";
        dialog.returnValue = "";
        dialog.remove();
        resolve(confirmed);
      },
      { once: true },
    );

    form.append(cancelButton, confirmButton);
    dialog.append(heading, body, form);
    document.body.append(dialog);
    if (typeof dialog.showModal !== "function") {
      dialog.remove();
      if (typeof window.confirm === "function") {
        resolve(window.confirm(message));
      } else {
        resolve(true);
      }
      return;
    }
    dialog.showModal();
  });
}
