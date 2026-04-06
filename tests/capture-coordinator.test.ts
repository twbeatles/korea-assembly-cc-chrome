import { afterEach, describe, expect, it, vi } from "vitest";

import { createCaptureCoordinator } from "../src/content/capture-coordinator";

describe("capture coordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("captures subtitles from an accessible child frame and emits reset when content disappears", async () => {
    vi.useFakeTimers();

    document.body.innerHTML = `<iframe id="child-frame"></iframe>`;
    const frame = document.getElementById("child-frame") as HTMLIFrameElement;
    const childDocument = frame.contentDocument;
    expect(childDocument).toBeTruthy();

    childDocument!.open();
    childDocument!.write(`
      <div id="viewSubtit">
        <div class="smi_word row_1"><span>재경위 확정 자막</span></div>
      </div>
    `);
    childDocument!.close();

    const updates: string[] = [];
    const framePaths: number[][] = [];
    const resets: number[] = [];

    const coordinator = createCaptureCoordinator({
      getPrimarySelector: () => "",
      getPollingIntervalMs: () => 200,
      getProbeOptions: () => ({
        filterUnconfirmedEnabled: true,
        sourceUrl: "https://assembly.webcast.go.kr/main/player.asp?xcode=65",
      }),
      onUpdate: ({ probe }) => {
        updates.push(probe.text);
        framePaths.push(probe.framePath);
      },
      onReset: () => {
        resets.push(Date.now());
      },
      onError: (error) => {
        throw error;
      },
    });

    coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(updates).toEqual(["재경위 확정 자막"]);
    expect(framePaths).toEqual([[0]]);

    childDocument!.body.innerHTML = "";
    coordinator.scheduleTick(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(resets).toHaveLength(1);
    coordinator.stop();
  });

  it("rebinds observers when the subtitle target is replaced", async () => {
    vi.useFakeTimers();

    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word row_1"><span>초기 자막</span></div>
      </div>
    `;

    const updates: string[] = [];
    const coordinator = createCaptureCoordinator({
      getPrimarySelector: () => "",
      getPollingIntervalMs: () => 200,
      getProbeOptions: () => ({
        filterUnconfirmedEnabled: true,
        sourceUrl: "https://assembly.webcast.go.kr/main/player.asp?xcode=10",
      }),
      onUpdate: ({ probe }) => {
        updates.push(probe.text);
      },
      onReset: () => undefined,
      onError: (error) => {
        throw error;
      },
    });

    coordinator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(updates).toEqual(["초기 자막"]);

    document.body.innerHTML = `
      <div id="viewSubtit">
        <div class="smi_word row_2"><span>교체 후 자막</span></div>
      </div>
    `;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(updates.at(-1)).toBe("교체 후 자막");
    coordinator.stop();
  });
});
