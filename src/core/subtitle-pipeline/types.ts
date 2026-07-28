import type {
  SpeakerChannel,
  SubtitleCaptureMode,
  SessionState,
  SubtitleEntry,
} from "../subtitle-models";

export const MIN_COMPACT_ANCHOR = 10;
export const LARGE_APPEND_MIN = 200;

export interface PipelineSourceMeta {
  selector?: string;
  framePath?: number[];
  sourceNodeKey?: string;
  sourceCaptureMode?: SubtitleCaptureMode;
  speakerColor?: string;
  speakerChannel?: SpeakerChannel;
  forceNewEntry?: boolean;
}

export interface LiveRowCommitMeta extends PipelineSourceMeta {
  entryId?: string;
  baselineCompact?: string | null;
}

export interface PipelineResult {
  state: SessionState;
  changed: boolean;
  appendedEntry?: SubtitleEntry;
  reason?: string;
}

export interface IncrementalExtractResult {
  text: string;
  matched: boolean;
  duplicate: boolean;
  ambiguous: boolean;
  reason:
    | "empty"
    | "no_history"
    | "identical_history"
    | "contained_in_history"
    | "suffix"
    | "suffix_duplicate"
    | "history"
    | "history_duplicate"
    | "overlap"
    | "overlap_duplicate"
    | "full";
}
