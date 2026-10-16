import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void,
) => unknown;

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("offscreen main", () => {
  let listener: Listener;
  const createObjectURL = vi.fn<(blob: Blob) => string>();
  const revokeObjectURL = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    createObjectURL.mockReset().mockReturnValue("blob:test");
    revokeObjectURL.mockReset();
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener: (next: Listener) => {
            listener = next;
          },
        },
      },
    });
    // Preserve the original descriptors, including absent jsdom URL methods.
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    await import("../src/offscreen/main");
  });

  afterEach(() => vi.unstubAllGlobals());

  function dispatch(message: unknown) {
    const response = vi.fn();
    const keepChannelOpen = listener(message, {}, response);
    return { response, keepChannelOpen };
  }

  it.each([
    { content: "한글 🎙️ <자막>\n끝", contentParts: undefined },
    { content: "ignored", contentParts: ["한글 ", "🎙️ <자막>", "\n끝"] },
    { content: "한글 🎙️ <자막>\n끝", contentParts: [] },
  ])(
    "creates a blob containing the actual UTF-8 payload: %j",
    async (payload) => {
      const { response, keepChannelOpen } = dispatch({
        type: "OFFSCREEN_CREATE_BLOB_URL",
        ...payload,
        mimeType: "text/plain;charset=utf-8",
      });
      expect(keepChannelOpen).toBe(true);
      expect(response).toHaveBeenCalledExactlyOnceWith({
        ok: true,
        url: "blob:test",
      });
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0];
      expect(blob.type).toBe("text/plain;charset=utf-8");
      expect(await readBlob(blob)).toBe("한글 🎙️ <자막>\n끝");
      expect(blob.size).toBe(
        new TextEncoder().encode("한글 🎙️ <자막>\n끝").length,
      );
    },
  );

  it("revokes only owned URLs, exactly once", () => {
    dispatch({
      type: "OFFSCREEN_CREATE_BLOB_URL",
      content: "{}",
      mimeType: "application/json",
    });
    dispatch({ type: "OFFSCREEN_REVOKE_BLOB_URL", url: "blob:unowned" });
    expect(revokeObjectURL).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      expect(
        dispatch({ type: "OFFSCREEN_REVOKE_BLOB_URL", url: "blob:test" })
          .response,
      ).toHaveBeenCalledExactlyOnceWith({ ok: true });
    }
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:test");
  });

  it("reports creation failures without returning a successful URL", () => {
    createObjectURL.mockImplementationOnce(() => {
      throw new Error("blob allocation failed");
    });
    expect(
      dispatch({
        type: "OFFSCREEN_CREATE_BLOB_URL",
        content: "text",
        mimeType: "text/plain",
      }).response,
    ).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      error: "blob allocation failed",
    });
    dispatch({ type: "OFFSCREEN_REVOKE_BLOB_URL", url: "blob:test" });
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it.each([null, undefined, "OFFSCREEN_CREATE_BLOB_URL", {}, { type: "PING" }])(
    "ignores unrelated messages: %j",
    (message) => {
      const { response, keepChannelOpen } = dispatch(message);
      expect(keepChannelOpen).toBeUndefined();
      expect(response).not.toHaveBeenCalled();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(revokeObjectURL).not.toHaveBeenCalled();
    },
  );
});
