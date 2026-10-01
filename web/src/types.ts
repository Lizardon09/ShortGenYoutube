export type ModelChoice = "opus" | "sonnet" | "haiku" | "none";

export interface Settings {
  owner: string;
  repo: string;
  token: string;
  branch: string;
}

export type JobKind = "analyze" | "short";

// One workflow run started from this page, tracked until it finishes.
export interface Job {
  id: string; // request id, baked into the run's name
  kind: JobKind;
  label: string;
  created: number;
  status: string; // queued | in_progress | completed
  conclusion?: string;
  step?: string;
  error?: string;
  warning?: string;
  runId?: number;
  runUrl?: string;
  finished?: number;
  title?: string; // analyze: the video title, once known
  openWhenDone?: boolean; // analyze: show the results as soon as they land
  key?: string; // short: "<analysis id>#<rank>" of the moment it was cut from
  download?: string; // short: release asset URL
  size?: number;
}

export interface HeatPoint {
  start_time: number;
  end_time: number;
  value: number;
}

export interface Moment {
  rank: number;
  start: number;
  end: number;
  duration: number;
  title: string;
  hook: string;
  reason: string;
  scores: { hook: number; flow: number; value: number; trend: number } | null; // null: picked from replay data
  virality: number | null;
  replay: number | null;
  score: number;
}

// moments.json, as written by find_moments.py
export interface Analysis {
  video: {
    id: string;
    url: string;
    title: string;
    channel?: string;
    duration?: number;
    thumbnail?: string;
  };
  transcript_source: string | null;
  model: string;
  settings?: { clips?: number; min?: number; max?: number; instructions?: string; model?: string };
  heatmap: HeatPoint[] | null;
  moments: Moment[];
}

export interface ShortOptionsValue {
  mode: "blurfill" | "hardcrop" | "none";
  zoom: string; // text while editing; cleanZoom() before sending
  captions: boolean;
}

export interface ShortRequest extends ShortOptionsValue {
  url: string;
  start: number;
  end: number;
  label: string;
  key?: string;
}

export interface AnalyzeRequest {
  url: string;
  clips: number;
  min: number;
  max: number;
  instructions: string;
  model: ModelChoice;
}
