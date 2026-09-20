import { useEffect, useMemo, useState } from "react";

import { filterEntriesByQuery } from "../../../shared/copy-utils";
import type { SessionRecord } from "../../../core/subtitle-models";
import {
  cloneEntry,
  createId,
  type SubtitleEntry,
} from "../../../core/subtitle-models";
import { updateSessionContent } from "../../../storage/session-store";
import {
  areEntryIdsContiguous,
  resolveSelectedEntryIds,
  selectAllEntryIds,
  toggleSelectedEntryId,
} from "../../history-view-state";
import { confirmDestructiveAction } from "../confirm-dialog";
import {
  computeSplitTime,
  formatTagInput,
  parseLabelInput,
} from "../helpers";

interface HistoryEntriesDeps {
  selectedSession: SessionRecord | null;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionRecord | null>>;
  displaySession: SessionRecord | null;
  searchQuery: string;
  captureInProgress: boolean;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  requestRefresh: (
    messageOnSuccess?: string,
    options?: { preserveMessage?: boolean },
  ) => void;
}

/**
 * 자막 엔트리 도메인 (단일 책임: 선택·편집·병합·분할·삭제).
 */
export function useHistoryEntries({
  selectedSession,
  setSelectedSession,
  displaySession,
  searchQuery,
  captureInProgress,
  setMessage,
  requestRefresh,
}: HistoryEntriesDeps) {
  const [checkedEntryIds, setCheckedEntryIds] = useState<string[]>([]);
  const [editingEntryId, setEditingEntryId] = useState("");
  const [editingEntryText, setEditingEntryText] = useState("");
  const [editingEntrySpeakerLabel, setEditingEntrySpeakerLabel] = useState("");
  const [editingEntryNote, setEditingEntryNote] = useState("");
  const [editingEntryLabels, setEditingEntryLabels] = useState("");
  const [splitEntryId, setSplitEntryId] = useState("");
  const [splitDraft, setSplitDraft] = useState("");

  const filteredEntries = useMemo(
    () => filterEntriesByQuery(displaySession?.entries ?? [], searchQuery),
    [displaySession, searchQuery],
  );
  const checkedEntryIdSet = useMemo(
    () => new Set(checkedEntryIds),
    [checkedEntryIds],
  );
  const selectedEntries = useMemo(
    () => displaySession?.entries.filter((entry) => checkedEntryIdSet.has(entry.id)) ?? [],
    [checkedEntryIdSet, displaySession],
  );
  const allVisibleEntriesChecked =
    filteredEntries.length > 0 &&
    filteredEntries.every((entry) => checkedEntryIdSet.has(entry.id));

  useEffect(() => {
    setCheckedEntryIds((current) =>
      resolveSelectedEntryIds(current, displaySession?.entries ?? []),
    );
  }, [displaySession]);

  const persistSelectedEntries = async (
    entries: SubtitleEntry[],
    successMessage: string,
  ): Promise<void> => {
    if (!selectedSession) {
      return;
    }
    const updated = await updateSessionContent(selectedSession.id, { entries });
    setSelectedSession(updated);
    setCheckedEntryIds((current) =>
      resolveSelectedEntryIds(current, updated.entries),
    );
    requestRefresh(successMessage, { preserveMessage: false });
  };

  const handleToggleEntryHighlight = async (entryId: string): Promise<void> => {
    if (!selectedSession) {
      return;
    }
    await persistSelectedEntries(
      selectedSession.entries.map((entry) =>
        entry.id === entryId
          ? { ...cloneEntry(entry), highlighted: !entry.highlighted }
          : entry,
      ),
      "중요 표시를 저장했습니다.",
    );
  };

  const beginEditEntry = (entry: SubtitleEntry): void => {
    setEditingEntryId(entry.id);
    setEditingEntryText(entry.text);
    setEditingEntrySpeakerLabel(entry.speakerLabel ?? "");
    setEditingEntryNote(entry.entryNote ?? "");
    setEditingEntryLabels(formatTagInput(entry.labels));
  };

  const cancelEditEntry = (): void => {
    setEditingEntryId("");
    setEditingEntryText("");
    setEditingEntrySpeakerLabel("");
    setEditingEntryNote("");
    setEditingEntryLabels("");
  };

  const handleSaveEntryEdit = async (): Promise<void> => {
    if (!selectedSession || !editingEntryId) {
      return;
    }
    const text = editingEntryText.trim();
    if (!text) {
      setMessage("자막 내용은 비워둘 수 없습니다.");
      return;
    }
    await persistSelectedEntries(
      selectedSession.entries.map((entry) =>
        entry.id === editingEntryId
          ? {
              ...cloneEntry(entry),
              originalText: entry.originalText ?? entry.text,
              text,
              speakerLabel: editingEntrySpeakerLabel.trim() || undefined,
              entryNote: editingEntryNote.trim() || undefined,
              labels: parseLabelInput(editingEntryLabels),
            }
          : entry,
      ),
      "자막 수정 내용을 저장했습니다.",
    );
    cancelEditEntry();
  };

  const handleDeleteSelectedEntries = async (): Promise<void> => {
    if (!selectedSession || !selectedEntries.length) {
      return;
    }
    if (captureInProgress) {
      setMessage("수집 중인 기록은 자막을 삭제·병합·분할할 수 없습니다. 멈춘 뒤에 수정하세요.");
      return;
    }
    if (
      !(await confirmDestructiveAction(
        `선택한 자막 ${selectedEntries.length}개를 삭제할까요?`,
        { title: "자막 삭제", confirmLabel: "삭제" },
      ))
    ) {
      setMessage("선택 항목 삭제를 취소했습니다.");
      return;
    }
    const selectedIdSet = new Set(selectedEntries.map((entry) => entry.id));
    await persistSelectedEntries(
      selectedSession.entries.filter((entry) => !selectedIdSet.has(entry.id)),
      `선택한 자막 ${selectedEntries.length}개를 삭제했습니다.`,
    );
  };

  const handleMergeSelectedEntries = async (): Promise<void> => {
    if (!selectedSession || selectedEntries.length < 2) {
      setMessage("병합할 자막을 2개 이상 선택하세요.");
      return;
    }
    if (captureInProgress) {
      setMessage("수집 중인 기록은 자막을 삭제·병합·분할할 수 없습니다. 멈춘 뒤에 수정하세요.");
      return;
    }
    if (
      !areEntryIdsContiguous(
        selectedSession.entries,
        selectedEntries.map((entry) => entry.id),
      )
    ) {
      setMessage("연속된 자막만 병합할 수 있습니다.");
      return;
    }
    const selectedIdSet = new Set(selectedEntries.map((entry) => entry.id));
    const orderedSelected = selectedSession.entries.filter((entry) =>
      selectedIdSet.has(entry.id),
    );
    const first = orderedSelected[0];
    const last = orderedSelected[orderedSelected.length - 1];
    const merged: SubtitleEntry = {
      ...cloneEntry(first),
      id: createId("subtitle"),
      text: orderedSelected.map((entry) => entry.text).join(" "),
      originalText: orderedSelected
        .map((entry) => entry.originalText ?? entry.text)
        .join("\n"),
      endTime: last.endTime,
      highlighted: orderedSelected.some((entry) => entry.highlighted),
      entryNote: orderedSelected
        .map((entry) => entry.entryNote)
        .filter(Boolean)
        .join("\n"),
      labels: [
        ...new Set(orderedSelected.flatMap((entry) => entry.labels ?? [])),
      ],
      sourceEntryIds: orderedSelected.flatMap(
        (entry) => entry.sourceEntryIds ?? [entry.id],
      ),
    };
    const nextEntries: SubtitleEntry[] = [];
    let inserted = false;
    selectedSession.entries.forEach((entry) => {
      if (!selectedIdSet.has(entry.id)) {
        nextEntries.push(entry);
        return;
      }
      if (!inserted) {
        nextEntries.push(merged);
        inserted = true;
      }
    });
    await persistSelectedEntries(
      nextEntries,
      `선택한 자막 ${orderedSelected.length}개를 병합했습니다.`,
    );
    setCheckedEntryIds([merged.id]);
  };

  const handleSplitSelectedEntry = async (): Promise<void> => {
    if (!selectedSession || selectedEntries.length !== 1) {
      setMessage("분할할 자막 1개를 선택하세요.");
      return;
    }
    if (captureInProgress) {
      setMessage("수집 중인 기록은 자막을 삭제·병합·분할할 수 없습니다. 멈춘 뒤에 수정하세요.");
      return;
    }
    const target = selectedEntries[0];
    setSplitEntryId(target.id);
    setSplitDraft(target.text);
    setMessage("분할할 위치마다 줄바꿈을 넣은 뒤 분할 저장을 누르세요.");
  };

  const handleCancelSplitEntry = (): void => {
    setSplitEntryId("");
    setSplitDraft("");
    setMessage("자막 분할을 취소했습니다.");
  };

  const handleSaveSplitEntry = async (): Promise<void> => {
    if (!selectedSession || !splitEntryId) {
      return;
    }
    if (captureInProgress) {
      setMessage("수집 중인 기록은 자막을 삭제·병합·분할할 수 없습니다. 멈춘 뒤에 수정하세요.");
      return;
    }
    const target = selectedSession.entries.find(
      (entry) => entry.id === splitEntryId,
    );
    if (!target) {
      setMessage("분할할 자막을 찾지 못했습니다.");
      return;
    }
    const parts = splitDraft
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      setMessage("두 줄 이상으로 입력해야 분할할 수 있습니다.");
      return;
    }
    const startMs = Date.parse(target.startTime || target.timestamp);
    const endMs = Date.parse(target.endTime || target.timestamp);
    const safeStart = Number.isFinite(startMs) ? startMs : Date.now();
    const safeEnd =
      Number.isFinite(endMs) && endMs > safeStart
        ? endMs
        : safeStart + parts.length * 1000;
    const splitEntries = parts.map((text, index) => ({
      ...cloneEntry(target),
      id: createId("subtitle"),
      text,
      originalText: target.originalText ?? target.text,
      startTime: computeSplitTime(safeStart, safeEnd, index, parts.length),
      timestamp: computeSplitTime(safeStart, safeEnd, index, parts.length),
      endTime: computeSplitTime(safeStart, safeEnd, index + 1, parts.length),
      sourceEntryIds: target.sourceEntryIds ?? [target.id],
    }));
    await persistSelectedEntries(
      selectedSession.entries.flatMap((entry) =>
        entry.id === target.id ? splitEntries : [entry],
      ),
      `자막 1개를 ${splitEntries.length}개로 분할했습니다.`,
    );
    setCheckedEntryIds(splitEntries.map((entry) => entry.id));
    setSplitEntryId("");
    setSplitDraft("");
  };

  const handleSelectVisibleEntries = (): void => {
    setCheckedEntryIds((current) => [
      ...new Set([...current, ...selectAllEntryIds(filteredEntries)]),
    ]);
  };

  const handleToggleVisibleEntries = (): void => {
    if (allVisibleEntriesChecked) {
      setCheckedEntryIds((current) =>
        current.filter(
          (id) => !filteredEntries.some((entry) => entry.id === id),
        ),
      );
      return;
    }

    handleSelectVisibleEntries();
  };

  const handleToggleEntryChecked = (entryId: string): void => {
    setCheckedEntryIds((current) => toggleSelectedEntryId(current, entryId));
  };

  return {
    checkedEntryIds,
    setCheckedEntryIds,
    checkedEntryIdSet,
    filteredEntries,
    selectedEntries,
    allVisibleEntriesChecked,
    editingEntryId,
    editingEntryText,
    setEditingEntryText,
    editingEntrySpeakerLabel,
    setEditingEntrySpeakerLabel,
    editingEntryNote,
    setEditingEntryNote,
    editingEntryLabels,
    setEditingEntryLabels,
    splitEntryId,
    splitDraft,
    setSplitDraft,
    persistSelectedEntries,
    handleToggleEntryHighlight,
    beginEditEntry,
    cancelEditEntry,
    handleSaveEntryEdit,
    handleDeleteSelectedEntries,
    handleMergeSelectedEntries,
    handleSplitSelectedEntry,
    handleCancelSplitEntry,
    handleSaveSplitEntry,
    handleSelectVisibleEntries,
    handleToggleVisibleEntries,
    handleToggleEntryChecked,
  };
}
