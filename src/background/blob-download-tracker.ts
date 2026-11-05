interface BlobDownloadDependencies {
  readSnapshot: () => Promise<unknown>;
  writeSnapshot: (snapshot: Record<string, string>) => Promise<void>;
  getState: (id: number) => Promise<string | undefined>;
  revoke: (url: string) => Promise<void>;
}

/** Offscreen documents outlive SW suspension. Restore before any mutation and
 * serialize snapshots so concurrent completion cannot resurrect older mappings. */
export function createBlobDownloadTracker(
  dependencies: BlobDownloadDependencies,
) {
  const urls = new Map<number, string>();
  let restored = false;
  let queue: Promise<unknown> = Promise.resolve();

  const restore = async (): Promise<void> => {
    if (restored) return;
    const snapshot = await dependencies.readSnapshot();
    if (snapshot && typeof snapshot === "object") {
      for (const [key, value] of Object.entries(snapshot)) {
        const id = Number(key);
        if (
          Number.isInteger(id) &&
          id >= 0 &&
          typeof value === "string" &&
          value.startsWith("blob:")
        )
          urls.set(id, value);
      }
    }
    restored = true;
  };
  const persist = () => dependencies.writeSnapshot(Object.fromEntries(urls));
  const remove = async (id: number): Promise<void> => {
    const url = urls.get(id);
    if (!url) return;
    await dependencies.revoke(url);
    urls.delete(id);
  };
  const terminal = (state: string | undefined) =>
    !state || state === "complete" || state === "interrupted";
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = async () => {
      await restore();
      return task();
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    track: (id: number, url: string) =>
      enqueue(async () => {
        urls.set(id, url);
        // onChanged can arrive before downloads.download's callback. Inspect
        // actual state after tracking rather than waiting for a second event.
        if (terminal(await dependencies.getState(id))) await remove(id);
        await persist();
      }),
    complete: (id: number) =>
      enqueue(async () => {
        if (!urls.has(id)) return;
        await remove(id);
        await persist();
      }),
    cleanup: () =>
      enqueue(async () => {
        for (const id of urls.keys()) {
          if (terminal(await dependencies.getState(id))) await remove(id);
        }
        await persist();
      }),
  };
}
