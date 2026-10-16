// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readBlobTextWithProgress } from "../src/history/blob-read";

describe("JSON blob reading", () => {
  it("preserves Korean characters crossing the production 256 KiB boundary", async () => {
    const text = '{"text":"' + "a".repeat(256 * 1024 - 10) + '국회 🎙️"}';
    expect(await readBlobTextWithProgress(new Blob([text]))).toBe(text);
  });
  it.each([1, 2, 3, 7, 256 * 1024])(
    "preserves UTF-8 across %i-byte chunks",
    async (chunkSize) => {
      const text = JSON.stringify({
        note: "국회 자막 🎙️",
        entries: ["가나다", "👨‍👩‍👧‍👦"],
      });
      const blob = new Blob([text]);
      const progress: Array<{ completed: number; total: number }> = [];
      const result = await readBlobTextWithProgress(blob, {
        chunkSize,
        onProgress: (value) => progress.push(value),
      });
      expect(result).toBe(text);
      expect(JSON.parse(result)).toEqual(JSON.parse(text));
      expect(progress[0]).toEqual({ completed: 0, total: blob.size });
      expect(progress.at(-1)).toEqual({
        completed: blob.size,
        total: blob.size,
      });
      expect(
        progress.every(
          (value, index) =>
            value.total === blob.size &&
            (index === 0 || value.completed > progress[index - 1].completed),
        ),
      ).toBe(true);
    },
  );

  it("rejects cancellation during reading without reporting completion", async () => {
    const controller = new AbortController();
    const completed: number[] = [];
    await expect(
      readBlobTextWithProgress(new Blob(["국회 자막 🎙️".repeat(10)]), {
        chunkSize: 4,
        signal: controller.signal,
        onProgress: (progress) => {
          completed.push(progress.completed);
          if (progress.completed > 0) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(completed).toEqual([0, 4]);
  });

  it("rejects a pre-aborted signal even for an empty file", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readBlobTextWithProgress(new Blob([]), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
