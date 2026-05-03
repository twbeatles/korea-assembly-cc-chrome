import type { SessionRecord } from "../core/subtitle-models";

interface PageExitPersistOptions {
  queueRecord: (record: SessionRecord) => Promise<void>;
  queueRecordInBackground?: (record: SessionRecord) => void | Promise<void>;
  persistRecordInBackground: (record: SessionRecord) => void;
  onPersistAttempt?: (record: SessionRecord) => void | Promise<void>;
  onQueueError?: (error: unknown) => void;
}

export async function persistQueuedPageExitRecord(
  record: SessionRecord,
  options: PageExitPersistOptions,
): Promise<void> {
  await options.onPersistAttempt?.(record);
  try {
    await options.queueRecord(record);
  } catch (error) {
    options.onQueueError?.(error);
    if (options.queueRecordInBackground) {
      void Promise.resolve(options.queueRecordInBackground(record)).catch((backgroundError) => {
        options.onQueueError?.(backgroundError);
      });
    }
  }

  options.persistRecordInBackground(record);
}
