/**
 * history App.tsx 의 session-detail JSX 를 SessionDetailPanel 로 분리.
 * presentational only — 상태/핸들러는 App 조립 루트 유지.
 */
import fs from "node:fs";
import path from "node:path";

const appPath = path.join("src/history/app/App.tsx");
const outPath = path.join("src/history/app/sections/SessionDetailPanel.tsx");

let app = fs.readFileSync(appPath, "utf8").replace(/\r\n/g, "\n");

if (app.includes('from "./sections/SessionDetailPanel"')) {
  console.log("already split");
  process.exit(0);
}

const startMarker = '        <section className="session-detail">';
const startIdx = app.indexOf(startMarker);
if (startIdx < 0) {
  console.error("start marker not found");
  process.exit(1);
}

// Find matching close of session-detail section: first `        </section>` after start
// that closes this section. Content is indented with 10 spaces for children.
// Closing tag is exactly 8 spaces + </section>
const closeTag = "\n        </section>";
const detailEnd = app.indexOf(closeTag, startIdx);
if (detailEnd < 0) {
  console.error("end not found");
  process.exit(1);
}
const fullDetail = app.slice(startIdx, detailEnd + closeTag.length);

const propNames = [
  "selectedSession",
  "displaySession",
  "selectedLineageId",
  "selectedLineageSummary",
  "availableLineageSessions",
  "lineageAggregateSession",
  "hasLineageSegments",
  "showingLineageView",
  "shouldShowSelectedSegmentLabel",
  "lineageLoading",
  "selectedEstimatedBytes",
  "totalSessionCount",
  "showStarredOnly",
  "actionButtonsDisabled",
  "noteDraft",
  "tagDraft",
  "categoryDraft",
  "speakerPrimaryDraft",
  "speakerSecondaryDraft",
  "speakerUnknownDraft",
  "hasUnsavedNote",
  "hasUnsavedMetadata",
  "hasUnsavedSessionDraft",
  "searchQuery",
  "filteredEntries",
  "selectedEntries",
  "checkedEntryIds",
  "checkedEntryIdSet",
  "allVisibleEntriesChecked",
  "shouldOfferSplitExport",
  "exportTimeFrom",
  "exportTimeTo",
  "editingEntryId",
  "editingEntryText",
  "editingEntrySpeakerLabel",
  "editingEntryNote",
  "editingEntryLabels",
  "splitEntryId",
  "splitDraft",
  "recentCopyLineCount",
  "runBusyHistoryAction",
  "setLineageViewEnabled",
  "setNoteDraft",
  "setTagDraft",
  "setCategoryDraft",
  "setSpeakerPrimaryDraft",
  "setSpeakerSecondaryDraft",
  "setSpeakerUnknownDraft",
  "setSearchQuery",
  "setCheckedEntryIds",
  "setExportTimeFrom",
  "setExportTimeTo",
  "setEditingEntryText",
  "setEditingEntrySpeakerLabel",
  "setEditingEntryNote",
  "setEditingEntryLabels",
  "setSplitDraft",
  "handleToggleFavorite",
  "handleReopen",
  "handleDelete",
  "handleSelectLineageSegment",
  "handleSaveNote",
  "handleSaveSessionMetadata",
  "discardUnsavedNoteDraft",
  "handleToggleVisibleEntries",
  "handleCopy",
  "handleExport",
  "handleSplitLineageExport",
  "handleToggleEntryChecked",
  "handleToggleEntryHighlight",
  "handleSaveEntryEdit",
  "handleDeleteSelectedEntries",
  "handleMergeSelectedEntries",
  "handleSplitSelectedEntry",
  "handleSaveSplitEntry",
  "handleCancelSplitEntry",
  "beginEditEntry",
  "cancelEditEntry",
];

const component = `/**
 * History 우측 세션 상세 패널 (presentational).
 * 상태·핸들러는 App 조립 루트에 두고 UI 만 분리한다.
 */
import type { ExportFormat, SessionRecord, SubtitleEntry } from "../../../core/subtitle-models";
import type { SessionLineageSummary } from "../../../storage/types";
import { SESSION_NOTE_MAX_LENGTH } from "../../../storage/session-store";
import { getExportFormatLabel } from "../../../shared/ui-labels";
import {
  EXPORT_FORMATS,
  canReopenSourceUrl,
  formatDate,
  getSessionSegmentLabel,
  resolveSpeakerLabel,
} from "../helpers";
import { buildCopyText } from "../../../shared/copy-utils";

export interface SessionDetailPanelProps {
  selectedSession: SessionRecord | null;
  displaySession: SessionRecord | null;
  selectedLineageId: string;
  selectedLineageSummary: SessionLineageSummary | null;
  availableLineageSessions: SessionRecord[];
  lineageAggregateSession: SessionRecord | null;
  hasLineageSegments: boolean;
  showingLineageView: boolean;
  shouldShowSelectedSegmentLabel: boolean;
  lineageLoading: boolean;
  selectedEstimatedBytes: number;
  totalSessionCount: number;
  showStarredOnly: boolean;
  actionButtonsDisabled: boolean;
  noteDraft: string;
  tagDraft: string;
  categoryDraft: string;
  speakerPrimaryDraft: string;
  speakerSecondaryDraft: string;
  speakerUnknownDraft: string;
  hasUnsavedNote: boolean;
  hasUnsavedMetadata: boolean;
  hasUnsavedSessionDraft: boolean;
  searchQuery: string;
  filteredEntries: SubtitleEntry[];
  selectedEntries: SubtitleEntry[];
  checkedEntryIds: string[];
  checkedEntryIdSet: Set<string>;
  allVisibleEntriesChecked: boolean;
  shouldOfferSplitExport: boolean;
  exportTimeFrom: string;
  exportTimeTo: string;
  editingEntryId: string;
  editingEntryText: string;
  editingEntrySpeakerLabel: string;
  editingEntryNote: string;
  editingEntryLabels: string;
  splitEntryId: string;
  splitDraft: string;
  recentCopyLineCount: number;
  runBusyHistoryAction: (
    actionLabel: string,
    action: () => Promise<void>,
    fallbackMessage: string,
    busyMessage?: string,
  ) => void;
  setLineageViewEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setNoteDraft: React.Dispatch<React.SetStateAction<string>>;
  setTagDraft: React.Dispatch<React.SetStateAction<string>>;
  setCategoryDraft: React.Dispatch<React.SetStateAction<string>>;
  setSpeakerPrimaryDraft: React.Dispatch<React.SetStateAction<string>>;
  setSpeakerSecondaryDraft: React.Dispatch<React.SetStateAction<string>>;
  setSpeakerUnknownDraft: React.Dispatch<React.SetStateAction<string>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setCheckedEntryIds: React.Dispatch<React.SetStateAction<string[]>>;
  setExportTimeFrom: React.Dispatch<React.SetStateAction<string>>;
  setExportTimeTo: React.Dispatch<React.SetStateAction<string>>;
  setEditingEntryText: React.Dispatch<React.SetStateAction<string>>;
  setEditingEntrySpeakerLabel: React.Dispatch<React.SetStateAction<string>>;
  setEditingEntryNote: React.Dispatch<React.SetStateAction<string>>;
  setEditingEntryLabels: React.Dispatch<React.SetStateAction<string>>;
  setSplitDraft: React.Dispatch<React.SetStateAction<string>>;
  handleToggleFavorite: (lineage: SessionLineageSummary) => void | Promise<void>;
  handleReopen: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleSelectLineageSegment: (sessionId: string) => void;
  handleSaveNote: () => Promise<void>;
  handleSaveSessionMetadata: () => Promise<void>;
  discardUnsavedNoteDraft: () => void;
  handleToggleVisibleEntries: () => void;
  handleCopy: (text: string, successMessage: string) => Promise<void>;
  handleExport: (format: ExportFormat, entries?: SubtitleEntry[]) => Promise<void>;
  handleSplitLineageExport: (format: ExportFormat) => Promise<void>;
  handleToggleEntryChecked: (entryId: string) => void;
  handleToggleEntryHighlight: (entryId: string) => Promise<void>;
  handleSaveEntryEdit: () => Promise<void>;
  handleDeleteSelectedEntries: () => Promise<void>;
  handleMergeSelectedEntries: () => Promise<void>;
  handleSplitSelectedEntry: () => void | Promise<void>;
  handleSaveSplitEntry: () => Promise<void>;
  handleCancelSplitEntry: () => void;
  beginEditEntry: (entry: SubtitleEntry) => void;
  cancelEditEntry: () => void;
}

export function SessionDetailPanel(props: SessionDetailPanelProps) {
  const {
${propNames.map((n) => `    ${n},`).join("\n")}
  } = props;

  return (
${fullDetail}
  );
}
`;

fs.writeFileSync(outPath, component, "utf8");
console.log("wrote", outPath, fullDetail.length);

const propJsx = propNames.map((n) => `          ${n}={${n}}`).join("\n");
const replacement = `        <SessionDetailPanel\n${propJsx}\n        />`;

const nextApp =
  app.slice(0, startIdx) + replacement + app.slice(detailEnd + closeTag.length);

const withImport = nextApp.replace(
  'import { HistoryHero } from "./sections/HistoryHero";',
  'import { HistoryHero } from "./sections/HistoryHero";\nimport { SessionDetailPanel } from "./sections/SessionDetailPanel";',
);

fs.writeFileSync(appPath, withImport, "utf8");
console.log("updated App.tsx lines", withImport.split("\n").length);
