import { useEffect, useMemo, useRef, useState } from "react";

import type { SessionRecord } from "../../../core/subtitle-models";
import { resolveSessionLineageId } from "../../../core/subtitle-models";
import {
  isSegmentedSessionRecord,
  mergeSessionSegments,
} from "../../../core/session-lineage";
import {
  CAPTURE_OWNERSHIP_STORAGE_KEY,
  isLiveCaptureOwnershipForSession,
  type CaptureOwnershipSnapshot,
} from "../../../content/runtime/capture-ownership";
import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_STORAGE_KEY,
  SESSION_LIBRARY_REVISION_STORAGE_KEY,
} from "../../../shared/constants";
import { getSettings } from "../../../storage/settings-store";
import {
  listSessionLineageSegments,
  updateSessionLineageMetadata,
  updateSessionMetadata,
} from "../../../storage/session-store";
import type { SessionLineageSummary } from "../../../storage/types";
import {
  extractHistoryViewSettings,
  selectHistoryViewSettings,
} from "../../history-view-state";
import {
  LARGE_LINEAGE_EXPORT_WARNING_BYTES,
  estimateSessionExportBytes,
  formatTagInput,
  parseTagInput,
} from "../helpers";

interface HistoryDetailDeps {
  selectedSession: SessionRecord | null;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionRecord | null>>;
  selectedLineageSummary: SessionLineageSummary | null;
  requestRefresh: (
    messageOnSuccess?: string,
    options?: { preserveMessage?: boolean },
  ) => void;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * 선택 세션 상세 도메인 (단일 책임: 계열·초안·메타데이터·보기 설정).
 */
export function useHistoryDetail({
  selectedSession,
  setSelectedSession,
  selectedLineageSummary,
  requestRefresh,
  setMessage,
}: HistoryDetailDeps) {
  const noteDraftRef = useRef("");
  const tagDraftRef = useRef("");
  const categoryDraftRef = useRef("");
  const previousSelectedSessionRef = useRef<SessionRecord | null>(null);
  const [lineageSessions, setLineageSessions] = useState<SessionRecord[]>([]);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageViewEnabled, setLineageViewEnabled] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [speakerPrimaryDraft, setSpeakerPrimaryDraft] = useState("");
  const [speakerSecondaryDraft, setSpeakerSecondaryDraft] = useState("");
  const [speakerUnknownDraft, setSpeakerUnknownDraft] = useState("");
  const [recentCopyLineCount, setRecentCopyLineCount] = useState(5);
  const [filenamePattern, setFilenamePattern] = useState(
    DEFAULT_EXTENSION_SETTINGS.filenamePattern,
  );
  const [txtExportTimestampsEnabled, setTxtExportTimestampsEnabled] = useState(
    DEFAULT_EXTENSION_SETTINGS.txtExportTimestampsEnabled,
  );
  const [txtExportSpeakerEnabled, setTxtExportSpeakerEnabled] = useState(
    DEFAULT_EXTENSION_SETTINGS.txtExportSpeakerEnabled,
  );
  const [panelSpeakerHighlightEnabled, setPanelSpeakerHighlightEnabled] = useState(
    DEFAULT_EXTENSION_SETTINGS.panelSpeakerHighlightEnabled,
  );
  const [liveCaptureSessionId, setLiveCaptureSessionId] = useState("");

  const selectedLineageId =
    selectedLineageSummary?.lineageId ??
    (selectedSession
      ? resolveSessionLineageId(selectedSession.id, selectedSession.lineageId)
      : "");
  const availableLineageSessions = useMemo(
    () =>
      selectedSession
        ? lineageSessions.length
          ? lineageSessions
          : [selectedSession]
        : [],
    [lineageSessions, selectedSession],
  );
  const hasLineageSegments = availableLineageSessions.length > 1;
  const lineageAggregateSession = useMemo(
    () =>
      hasLineageSegments ? mergeSessionSegments(availableLineageSessions) : null,
    [availableLineageSessions, hasLineageSegments],
  );
  const displaySession =
    lineageViewEnabled && lineageAggregateSession ? lineageAggregateSession : selectedSession;
  const displayExportEstimateBytes = useMemo(
    () =>
      displaySession
        ? estimateSessionExportBytes(
            displaySession,
            txtExportTimestampsEnabled,
            txtExportSpeakerEnabled,
          )
        : 0,
    [displaySession, txtExportTimestampsEnabled, txtExportSpeakerEnabled],
  );
  const hasUnsavedNote =
    selectedSession
      ? noteDraft !== (selectedLineageSummary?.note ?? selectedSession.note)
      : noteDraft.trim().length > 0;
  const hasUnsavedMetadata = selectedSession
    ? tagDraft !== formatTagInput(selectedSession.tags) ||
      categoryDraft !== (selectedSession.category ?? "") ||
      speakerPrimaryDraft !== (selectedSession.speakerLabels?.primary ?? "") ||
      speakerSecondaryDraft !== (selectedSession.speakerLabels?.secondary ?? "") ||
      speakerUnknownDraft !== (selectedSession.speakerLabels?.unknown ?? "")
    : false;
  const hasUnsavedSessionDraft = hasUnsavedNote || hasUnsavedMetadata;
  const captureInProgress =
    selectedSession?.status === "running" ||
    Boolean(selectedSession && liveCaptureSessionId === selectedSession.id);
  const showingLineageView = lineageViewEnabled && hasLineageSegments && !!lineageAggregateSession;
  const shouldOfferSplitExport =
    showingLineageView && displayExportEstimateBytes > LARGE_LINEAGE_EXPORT_WARNING_BYTES;
  const selectedEstimatedBytes = displayExportEstimateBytes;
  const shouldShowSelectedSegmentLabel =
    !!selectedSession && (hasLineageSegments || isSegmentedSessionRecord(selectedSession));

  const discardUnsavedNoteDraft = (): void => {
    setNoteDraft(selectedLineageSummary?.note ?? selectedSession?.note ?? "");
  };

  useEffect(() => {
    noteDraftRef.current = noteDraft;
  }, [noteDraft]);

  useEffect(() => {
    tagDraftRef.current = tagDraft;
  }, [tagDraft]);

  useEffect(() => {
    categoryDraftRef.current = categoryDraft;
  }, [categoryDraft]);

  useEffect(() => {
    if (!hasUnsavedSessionDraft) {
      return;
    }

    const handler = (event: BeforeUnloadEvent): void => {
      // Modern browsers ignore the message text but still show their own
      // confirmation when `returnValue` is set. The guard only fires while a
      // dirty draft is present so navigation/reload during normal browsing is
      // unaffected.
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [hasUnsavedSessionDraft]);

  useEffect(() => {
    const previousSelectedSession = previousSelectedSessionRef.current;
    const selectedSessionIdChanged =
      previousSelectedSession?.id !== selectedSession?.id;

    if (selectedSessionIdChanged) {
      setNoteDraft(selectedLineageSummary?.note ?? selectedSession?.note ?? "");
    } else if (
      previousSelectedSession &&
      selectedSession &&
      noteDraftRef.current === previousSelectedSession.note
    ) {
      setNoteDraft(selectedLineageSummary?.note ?? selectedSession.note);
    }
    previousSelectedSessionRef.current = selectedSession;
  }, [selectedLineageSummary, selectedSession]);

  useEffect(() => {
    let active = true;

    if (!selectedSession) {
      setLineageSessions([]);
      setLineageLoading(false);
      setLineageViewEnabled(false);
      return () => {
        active = false;
      };
    }

    setLineageSessions([selectedSession]);
    setLineageLoading(true);
    void listSessionLineageSegments(resolveSessionLineageId(selectedSession.id, selectedSession.lineageId))
      .then((sessions) => {
        if (!active) {
          return;
        }

        const nextSessions = sessions.length ? sessions : [selectedSession];
        setLineageSessions(nextSessions);
        const hydratedSelectedSession =
          nextSessions.find((session) => session.id === selectedSession.id) ?? null;
        if (
          selectedSession.entries.length === 0 &&
          hydratedSelectedSession &&
          hydratedSelectedSession.entries.length > 0
        ) {
          setSelectedSession((current) =>
            current?.id === hydratedSelectedSession.id ? hydratedSelectedSession : current,
          );
        }
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setLineageSessions([selectedSession]);
      })
      .finally(() => {
        if (active) {
          setLineageLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedSession, setSelectedSession]);

  useEffect(() => {
    if (!lineageLoading && availableLineageSessions.length <= 1) {
      setLineageViewEnabled(false);
    } else if (!lineageLoading && availableLineageSessions.length > 1) {
      setLineageViewEnabled(true);
    }
  }, [availableLineageSessions.length, lineageLoading]);

  useEffect(() => {
    let active = true;

    void getSettings()
      .then((settings) => {
        if (!active) {
          return;
        }

        const nextSettings = selectHistoryViewSettings(settings);
        setRecentCopyLineCount(nextSettings.recentCopyLineCount);
        setFilenamePattern(nextSettings.filenamePattern);
        setTxtExportTimestampsEnabled(nextSettings.txtExportTimestampsEnabled);
        setTxtExportSpeakerEnabled(nextSettings.txtExportSpeakerEnabled);
        setPanelSpeakerHighlightEnabled(nextSettings.panelSpeakerHighlightEnabled);
      })
      .catch(() => {
        // Keep defaults if settings cannot be loaded from a standalone history page.
      });

    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) {
      return () => {
        active = false;
      };
    }

    const applyOwnershipSnapshot = (value: unknown): void => {
      const snapshot = value as CaptureOwnershipSnapshot | null;
      if (snapshot && typeof snapshot.sessionId === "string" && snapshot.sessionId) {
        setLiveCaptureSessionId(
          isLiveCaptureOwnershipForSession(snapshot, snapshot.sessionId)
            ? snapshot.sessionId
            : "",
        );
        return;
      }
      setLiveCaptureSessionId("");
    };

    if (chrome.storage.local?.get) {
      void chrome.storage.local
        .get(CAPTURE_OWNERSHIP_STORAGE_KEY)
        .then((snapshot) => {
          if (!active) {
            return;
          }
          applyOwnershipSnapshot(snapshot[CAPTURE_OWNERSHIP_STORAGE_KEY]);
        })
        .catch(() => {
          // History can still use persisted session status without ownership.
        });
    }

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (!active || areaName !== "local") {
        return;
      }

      if (changes[EXTENSION_STORAGE_KEY]) {
        const nextSettings = extractHistoryViewSettings(
          changes[EXTENSION_STORAGE_KEY].newValue,
        );
        setRecentCopyLineCount(nextSettings.recentCopyLineCount);
        setFilenamePattern(nextSettings.filenamePattern);
        setTxtExportTimestampsEnabled(nextSettings.txtExportTimestampsEnabled);
        setTxtExportSpeakerEnabled(nextSettings.txtExportSpeakerEnabled);
        setPanelSpeakerHighlightEnabled(nextSettings.panelSpeakerHighlightEnabled);
      }

      if (changes[SESSION_LIBRARY_REVISION_STORAGE_KEY]) {
        requestRefresh(undefined, { preserveMessage: true });
      }

      if (changes[CAPTURE_OWNERSHIP_STORAGE_KEY]) {
        applyOwnershipSnapshot(changes[CAPTURE_OWNERSHIP_STORAGE_KEY].newValue);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [requestRefresh]);

  const handleSaveNote = async (): Promise<void> => {
    if (!selectedLineageId) {
      return;
    }

    try {
      await updateSessionLineageMetadata(selectedLineageId, {
        note: noteDraft,
      });
      requestRefresh(
        noteDraft.trim() ? "메모를 저장했습니다." : "메모를 비웠습니다.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "메모 저장에 실패했습니다.",
      );
    }
  };

  const handleSaveSessionMetadata = async (): Promise<void> => {
    if (!selectedSession) {
      return;
    }

    try {
      await updateSessionMetadata(selectedSession.id, {
        note: noteDraft,
        tags: parseTagInput(tagDraft),
        category: categoryDraft.trim(),
        speakerLabels: {
          primary: speakerPrimaryDraft.trim(),
          secondary: speakerSecondaryDraft.trim(),
          unknown: speakerUnknownDraft.trim(),
        },
      });
      requestRefresh("세션 메타데이터를 저장했습니다.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "세션 메타데이터 저장에 실패했습니다.",
      );
    }
  };

  return {
    selectedLineageId,
    availableLineageSessions,
    hasLineageSegments,
    lineageAggregateSession,
    displaySession,
    displayExportEstimateBytes,
    selectedEstimatedBytes,
    shouldOfferSplitExport,
    shouldShowSelectedSegmentLabel,
    showingLineageView,
    lineageLoading,
    lineageViewEnabled,
    setLineageViewEnabled,
    searchQuery,
    setSearchQuery,
    noteDraft,
    setNoteDraft,
    tagDraft,
    setTagDraft,
    categoryDraft,
    setCategoryDraft,
    speakerPrimaryDraft,
    setSpeakerPrimaryDraft,
    speakerSecondaryDraft,
    setSpeakerSecondaryDraft,
    speakerUnknownDraft,
    setSpeakerUnknownDraft,
    hasUnsavedNote,
    hasUnsavedMetadata,
    hasUnsavedSessionDraft,
    discardUnsavedNoteDraft,
    captureInProgress,
    liveCaptureSessionId,
    recentCopyLineCount,
    filenamePattern,
    txtExportTimestampsEnabled,
    txtExportSpeakerEnabled,
    panelSpeakerHighlightEnabled,
    handleSaveNote,
    handleSaveSessionMetadata,
  };
}
