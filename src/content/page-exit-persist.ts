import type { SessionRecord } from "../core/subtitle-models";

interface PageExitPersistOptions {
  queueRecord: (record: SessionRecord) => Promise<void>;
  persistRecordInBackground: (record: SessionRecord) => void;
  onQueueError?: (error: unknown) => void;
}

export async function persistQueuedPageExitRecord(
  record: SessionRecord,
  options: PageExitPersistOptions,
): Promise<void> {
  try {
    await options.queueRecord(record);
  } catch (error) {
    options.onQueueError?.(error);
  }

  options.persistRecordInBackground(record);
}
