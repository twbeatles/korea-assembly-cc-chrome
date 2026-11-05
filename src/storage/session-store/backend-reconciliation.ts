import {
  getSessionCharCount,
  type SessionRecord,
} from "../../core/subtitle-models";
import { mergeSessionCollections } from "./lineage-helpers";
import {
  mergeCaptureEntriesWithUserEdits,
  mergeCaptureSnapshotWithStoredEdits,
} from "./normalize";

export const EDITABLE_METADATA_FIELDS = [
  "starred",
  "pinnedAt",
  "note",
  "tags",
  "category",
  "speakerLabels",
  "qualityStats",
] as const;
export type EditableMetadataField = (typeof EDITABLE_METADATA_FIELDS)[number];

// Internal fallback provenance; normalization strips this from IDB and exports.
// Without it an unreadable IDB baseline is indistinguishable from user-cleared
// metadata when the database becomes available again.
export type ReconciliableRecord = SessionRecord & {
  unreconciledFallback?: { editedMetadata: EditableMetadataField[] };
};

export function editedMetadataFields(patch: object): EditableMetadataField[] {
  const values = patch as Record<string, unknown>;
  return EDITABLE_METADATA_FIELDS.filter(
    (field) =>
      values[field] !== undefined ||
      (field === "pinnedAt" && values.starred !== undefined),
  );
}

export function selectLatestBackendRecord(
  idb?: SessionRecord,
  fallback?: SessionRecord,
): SessionRecord | undefined {
  const latest = mergeSessionCollections(
    idb ? [idb] : [],
    fallback ? [fallback] : [],
  )[0];
  if (latest) delete (latest as ReconciliableRecord).unreconciledFallback;
  const provenance = (fallback as ReconciliableRecord | undefined)
    ?.unreconciledFallback;
  if (
    !latest ||
    !idb ||
    !fallback ||
    !Array.isArray(provenance?.editedMetadata) ||
    latest.updatedAt <= idb.updatedAt
  )
    return latest;
  const reconciled = mergeCaptureSnapshotWithStoredEdits(fallback, idb);
  reconciled.entries = mergeCaptureEntriesWithUserEdits(
    reconciled.entries,
    fallback.entries,
  );
  for (const field of provenance.editedMetadata) {
    if (EDITABLE_METADATA_FIELDS.includes(field))
      Object.assign(reconciled, { [field]: fallback[field] });
  }
  delete (reconciled as ReconciliableRecord).unreconciledFallback;
  reconciled.charCount = getSessionCharCount(reconciled.entries);
  return reconciled;
}
