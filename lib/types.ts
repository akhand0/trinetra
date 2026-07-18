export type ProbeArm =
  | "latency_shift"
  | "error_cluster"
  | "deploy_correlation"
  | "trace_mining"
  | "cardinality_scan";

export type ContextBucket =
  | "latency_after_deploy"
  | "latency_general"
  | "errors_spike"
  | "trace_lookup"
  | "capacity"
  | "unknown";

export type PanelKind =
  | "timeline"
  | "heatmap"
  | "trace"
  | "errors"
  | "cardinality"
  | "deploy";

export type ProbeStatus = "queued" | "running" | "complete" | "adapted";

export interface SeriesPoint {
  label: string;
  value: number;
  secondary?: number;
}

export interface HeatCell {
  row: string;
  column: string;
  value: number;
}

export interface TraceSpan {
  id: string;
  service: string;
  operation: string;
  start: number;
  duration: number;
  status: "ok" | "error";
}

export interface PanelData {
  id: string;
  kind: PanelKind;
  arm: ProbeArm;
  eyebrow: string;
  title: string;
  summary: string;
  confidence: number;
  sampledScore: number;
  propensity: number;
  finding: string;
  accent: "orange" | "cyan" | "violet" | "red" | "green";
  series?: SeriesPoint[];
  heatmap?: HeatCell[];
  spans?: TraceSpan[];
  stats?: Array<{ label: string; value: string; tone?: "bad" | "good" | "neutral" }>;
}

export interface DagNode {
  id: string;
  label: string;
  detail: string;
  arm?: ProbeArm;
  status: ProbeStatus;
  duration?: string;
  score?: number;
}

export interface Posterior {
  arm: ProbeArm;
  label: string;
  alpha: number;
  beta: number;
  mean: number;
  sampled: number;
  trials: number;
  delta?: number;
}

export interface InvestigationEvent {
  type: "episode" | "node" | "panel" | "posterior" | "root_cause" | "done";
  episodeId?: string;
  node?: DagNode;
  panel?: PanelData;
  posterior?: Posterior[];
  rootCause?: RootCause;
  message?: string;
}

export interface RootCause {
  service: string;
  title: string;
  detail: string;
  confidence: number;
  traceId: string;
  since: string;
}

export interface RewardEvent {
  episodeId: string;
  contextBucket: ContextBucket;
  arm: ProbeArm;
  panelId: string;
  eventType:
    | "impression"
    | "dwell"
    | "click"
    | "expand"
    | "drilldown"
    | "confirm_root_cause";
  value: number;
  propensity: number;
}
