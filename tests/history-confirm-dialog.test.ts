import { beforeAll, describe, expect, it } from "vitest";

import { showNativeConfirmDialog } from "../src/history/app/confirm-dialog";

// jsdom 에는 <dialog>의 showModal/close 가 없어 플랫폼 동작을 최소 스텁한다.
function ensureDialogStub(): void {
  const dialogProto = HTMLDialogElement.prototype;
  if (typeof dialogProto.showModal !== "function") {
    dialogProto.showModal = function (this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
  }
  if (typeof dialogProto.close !== "function") {
    dialogProto.close = function (
      this: HTMLDialogElement,
      returnValue?: string,
    ): void {
      if (returnValue !== undefined) {
        this.returnValue = returnValue;
      }
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}

beforeAll(ensureDialogStub);

describe("history native confirm dialog", () => {
  it("renders an accessible modal with focus on the safe action", () => {
    const pending = showNativeConfirmDialog("지울까요?", {
      title: "기록 삭제",
      confirmLabel: "삭제",
    });

    const dialog = document.querySelector(
      "dialog.confirm-dialog",
    ) as HTMLDialogElement | null;
    expect(dialog).toBeTruthy();
    expect(dialog?.open).toBe(true);
    expect(dialog?.getAttribute("closedby")).toBe("any");
    expect(dialog?.getAttribute("role")).toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBeNull();
    expect(dialog?.querySelector("h2")?.textContent).toBe("기록 삭제");
    // jsdom 은 showModal 의 autofocus 를 구현하지 않아 속성으로 검증한다.
    expect(
      dialog
        ?.querySelector(".confirm-dialog-actions button.secondary")
        ?.hasAttribute("autofocus"),
    ).toBe(true);

    dialog!.returnValue = "";
    dialog!.close();
    return expect(pending).resolves.toBe(false);
  });

  it("resolves true only for the confirm button value", () => {
    const pending = showNativeConfirmDialog("지울까요?");
    const dialog = document.querySelector(
      "dialog.confirm-dialog",
    ) as HTMLDialogElement;

    dialog.returnValue = "confirm";
    dialog.close();
    return expect(pending).resolves.toBe(true);
  });
});
