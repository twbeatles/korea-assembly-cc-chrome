export interface BlobReadProgress {
  completed: number;
  total: number;
}

function createAbortError(message: string): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }

  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) {
    throw createAbortError(message);
  }
}

export async function readBlobTextWithProgress(
  blob: Blob,
  options: {
    signal?: AbortSignal;
    chunkSize?: number;
    onProgress?: (progress: BlobReadProgress) => void;
  } = {},
): Promise<string> {
  const total = Math.max(0, blob.size || 0);
  const chunkSize = Math.max(1, options.chunkSize ?? 256 * 1024);

  options.onProgress?.({
    completed: 0,
    total,
  });

  if (total > 0 && typeof blob.slice === "function") {
    const parts: string[] = [];

    for (let offset = 0; offset < total; offset += chunkSize) {
      throwIfAborted(options.signal, "JSON 가져오기를 취소했습니다.");
      const nextOffset = Math.min(total, offset + chunkSize);
      const chunkText = await blob.slice(offset, nextOffset).text();
      throwIfAborted(options.signal, "JSON 가져오기를 취소했습니다.");
      parts.push(chunkText);
      options.onProgress?.({
        completed: nextOffset,
        total,
      });
    }

    return parts.join("");
  }

  const text = await blob.text();
  throwIfAborted(options.signal, "JSON 가져오기를 취소했습니다.");
  options.onProgress?.({
    completed: total || text.length,
    total: total || text.length,
  });
  return text;
}
