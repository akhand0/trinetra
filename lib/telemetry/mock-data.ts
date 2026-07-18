import type {
  DagNode,
  HeatCell,
  PanelData,
  Posterior,
  RootCause,
  TraceSpan,
} from "@/lib/types";

export const DEMO_QUERY = "Why did checkout latency spike after Tuesday's deploy?";

export const ROOT_CAUSE: RootCause = {
  service: "payments-api",
  title: "Connection pool saturation",
  detail:
    "Deploy v2.14.0 reduced the Postgres pool from 40 to 12. Queueing begins 4 minutes after rollout and accounts for 81% of the p99 regression.",
  confidence: 96,
  traceId: "7d9f2a1c",
  since: "Tue 14:06 UTC",
};

const latencySeries = [
  174, 181, 176, 188, 193, 205, 212, 219, 228, 241, 248, 254,
].map((value, index) => ({
  label: `${index + 10}:00`,
  value,
  secondary:
    index < 5 ? 61 + index * 2 : 118 + Math.round((index - 5) * 24.5),
}));

const heatmapRows = [
  ["gateway", [0.06, 0.05, 0.07, 0.06, 0.07, 0.08, 0.09, 0.08]],
  ["checkout", [0.09, 0.1, 0.11, 0.12, 0.18, 0.26, 0.31, 0.29]],
  ["payments", [0.07, 0.08, 0.09, 0.11, 0.42, 0.74, 0.91, 0.87]],
  ["inventory", [0.04, 0.05, 0.04, 0.05, 0.06, 0.08, 0.08, 0.07]],
] as const;

const heatmap: HeatCell[] = heatmapRows.flatMap(([row, values]) =>
  values.map((value, index) => ({
    row,
    column: `${13 + Math.floor(index / 4)}:${(index % 4) * 15 || "00"}`,
    value,
  })),
);

const spans: TraceSpan[] = [
  {
    id: "s1",
    service: "web-gateway",
    operation: "POST /checkout",
    start: 0,
    duration: 100,
    status: "ok",
  },
  {
    id: "s2",
    service: "checkout-api",
    operation: "create_order",
    start: 5,
    duration: 88,
    status: "ok",
  },
  {
    id: "s3",
    service: "payments-api",
    operation: "authorize",
    start: 18,
    duration: 67,
    status: "error",
  },
  {
    id: "s4",
    service: "postgres",
    operation: "pool.acquire",
    start: 24,
    duration: 52,
    status: "error",
  },
  {
    id: "s5",
    service: "fraud-service",
    operation: "risk_score",
    start: 29,
    duration: 14,
    status: "ok",
  },
];

export const PANELS: Record<string, PanelData> = {
  timeline: {
    id: "panel-latency",
    kind: "timeline",
    arm: "latency_shift",
    eyebrow: "Latency shift",
    title: "p99 broke from baseline at 14:06",
    summary: "A clean step-change follows the rollout, not a gradual load trend.",
    confidence: 93,
    sampledScore: 0.89,
    propensity: 0.34,
    finding: "p99 +317% while request volume moved only +6%",
    accent: "orange",
    series: latencySeries,
    stats: [
      { label: "Before", value: "61 ms", tone: "neutral" },
      { label: "After", value: "254 ms", tone: "bad" },
      { label: "Change", value: "+317%", tone: "bad" },
    ],
  },
  heatmap: {
    id: "panel-heatmap",
    kind: "heatmap",
    arm: "error_cluster",
    eyebrow: "Error cluster",
    title: "Failures collapse onto payments-api",
    summary: "The error surface is narrow: one service, one operation, one window.",
    confidence: 91,
    sampledScore: 0.82,
    propensity: 0.28,
    finding: "91% saturation score in the payments service",
    accent: "red",
    heatmap,
    stats: [
      { label: "Errors", value: "1,842", tone: "bad" },
      { label: "Services", value: "1 of 8", tone: "neutral" },
      { label: "Window", value: "14 min", tone: "neutral" },
    ],
  },
  deploy: {
    id: "panel-deploy",
    kind: "deploy",
    arm: "deploy_correlation",
    eyebrow: "Deploy correlation",
    title: "v2.14.0 is the only coincident change",
    summary: "Configuration diff points directly at the connection pool regression.",
    confidence: 88,
    sampledScore: 0.78,
    propensity: 0.2,
    finding: "DB_POOL_MAX changed 40 → 12 at 14:02",
    accent: "violet",
    stats: [
      { label: "Commit", value: "6d14f2c", tone: "neutral" },
      { label: "Rollout", value: "14:02", tone: "neutral" },
      { label: "Lag", value: "4m 11s", tone: "bad" },
    ],
  },
  trace: {
    id: "panel-trace",
    kind: "trace",
    arm: "trace_mining",
    eyebrow: "Culprit trace",
    title: "81% of time waits on pool.acquire",
    summary:
      "The adaptive policy promoted trace mining after you opened the error cluster.",
    confidence: 96,
    sampledScore: 0.94,
    propensity: 0.42,
    finding: "7d9f2a1c · payments-api · pool.acquire",
    accent: "cyan",
    spans,
    stats: [
      { label: "Trace", value: "7d9f2a1c", tone: "neutral" },
      { label: "Total", value: "312 ms", tone: "bad" },
      { label: "DB wait", value: "253 ms", tone: "bad" },
    ],
  },
  cardinality: {
    id: "panel-cardinality",
    kind: "cardinality",
    arm: "cardinality_scan",
    eyebrow: "Exploratory miss",
    title: "Cardinality is healthy",
    summary:
      "The policy explored a lower-confidence arm, found no evidence, and recovered.",
    confidence: 34,
    sampledScore: 0.39,
    propensity: 0.11,
    finding: "No label explosion or hot partition detected",
    accent: "green",
    series: [
      { label: "Mon", value: 41 },
      { label: "Tue", value: 43 },
      { label: "Wed", value: 42 },
      { label: "Thu", value: 44 },
      { label: "Fri", value: 43 },
    ],
    stats: [
      { label: "Labels", value: "43", tone: "good" },
      { label: "Δ 7d", value: "+2.1%", tone: "good" },
      { label: "Verdict", value: "Clear", tone: "good" },
    ],
  },
};

export const INITIAL_POSTERIORS: Posterior[] = [
  {
    arm: "latency_shift",
    label: "Latency",
    alpha: 39,
    beta: 8,
    mean: 0.83,
    sampled: 0.89,
    trials: 45,
  },
  {
    arm: "error_cluster",
    label: "Errors",
    alpha: 31,
    beta: 10,
    mean: 0.76,
    sampled: 0.82,
    trials: 39,
  },
  {
    arm: "deploy_correlation",
    label: "Deploy",
    alpha: 26,
    beta: 12,
    mean: 0.68,
    sampled: 0.78,
    trials: 36,
  },
  {
    arm: "trace_mining",
    label: "Trace",
    alpha: 20,
    beta: 14,
    mean: 0.59,
    sampled: 0.63,
    trials: 32,
  },
  {
    arm: "cardinality_scan",
    label: "Cardinality",
    alpha: 8,
    beta: 18,
    mean: 0.31,
    sampled: 0.39,
    trials: 24,
  },
];

export const ADAPTED_POSTERIORS: Posterior[] = INITIAL_POSTERIORS.map(
  (posterior) =>
    posterior.arm === "trace_mining"
      ? {
          ...posterior,
          alpha: 28,
          beta: 14,
          mean: 0.67,
          sampled: 0.94,
          trials: 40,
          delta: 0.08,
        }
      : posterior.arm === "error_cluster"
        ? { ...posterior, alpha: 37, mean: 0.79, delta: 0.03 }
        : { ...posterior, delta: 0 },
);

export const INITIAL_DAG: DagNode[] = [
  {
    id: "intent",
    label: "Classify intent",
    detail: "latency_after_deploy",
    status: "complete",
    duration: "82 ms",
  },
  {
    id: "policy",
    label: "Sample policy",
    detail: "5 candidate probes",
    status: "complete",
    duration: "4 ms",
  },
  {
    id: "latency",
    label: "Latency shift",
    detail: "Compare p50 / p95 / p99",
    arm: "latency_shift",
    status: "queued",
    score: 0.89,
  },
  {
    id: "errors",
    label: "Error cluster",
    detail: "Locate concentrated failures",
    arm: "error_cluster",
    status: "queued",
    score: 0.82,
  },
  {
    id: "deploy",
    label: "Deploy correlate",
    detail: "Diff rollout and config",
    arm: "deploy_correlation",
    status: "queued",
    score: 0.78,
  },
];

export const LEARNING_CURVE = [
  { label: "Fri", value: 0.42, secondary: 12 },
  { label: "Sat", value: 0.5, secondary: 39 },
  { label: "Sun", value: 0.57, secondary: 78 },
  { label: "Mon", value: 0.64, secondary: 126 },
  { label: "Tue", value: 0.7, secondary: 181 },
  { label: "Wed", value: 0.77, secondary: 238 },
  { label: "Thu", value: 0.84, secondary: 312 },
];

export const RECENT_INCIDENTS = [
  {
    id: "INC-2048",
    title: "Checkout latency",
    time: "Live",
    tone: "critical",
  },
  {
    id: "INC-2042",
    title: "Auth 5xx burst",
    time: "2h",
    tone: "warning",
  },
  {
    id: "INC-2037",
    title: "Kafka consumer lag",
    time: "Yesterday",
    tone: "resolved",
  },
] as const;
