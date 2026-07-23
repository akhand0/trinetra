export const DETECTION_CADENCE_MINUTES = 5;
export const DETECTION_WINDOW_MINUTES = 5;
export const DETECTION_BASELINE_MINUTES = 30;

export const DETECTOR_CATALOG = [
  {
    id: "latency-regression",
    name: "Latency regression",
    description: "Compares service p99 with its rolling 30-minute baseline.",
  },
  {
    id: "error-rate-spike",
    name: "Error-rate spike",
    description: "Finds services whose trace error rate breaks its baseline.",
  },
  {
    id: "telemetry-freshness",
    name: "Telemetry freshness",
    description: "Detects stalled OpenTelemetry ingestion before coverage is lost.",
  },
] as const;

export type DetectorId = (typeof DETECTOR_CATALOG)[number]["id"];
export type DetectorStatus =
  | "healthy"
  | "triggered"
  | "no_data"
  | "error";
export type DetectionSeverity = "critical" | "high" | "warning" | "none";
export type DetectionUnit = "ms" | "percent" | "seconds";

export type DetectorEvaluation = {
  detectorId: DetectorId;
  name: string;
  description: string;
  status: DetectorStatus;
  severity: DetectionSeverity;
  service: string | null;
  observed: number | null;
  baseline: number | null;
  threshold: number | null;
  unit: DetectionUnit;
  finding: string;
  evaluatedAt: string;
  windowStart: string;
  windowEnd: string;
  matchedSeries: number;
  sampleCount: number;
};

export type DetectionIncident = {
  id: string;
  fingerprint: string;
  detectorId: DetectorId;
  openedAt: string;
  lastSeenAt: string;
  updatedAt: string;
  status: "open" | "resolved";
  severity: Exclude<DetectionSeverity, "none">;
  service: string | null;
  title: string;
  summary: string;
  observed: number | null;
  baseline: number | null;
  threshold: number | null;
  unit: DetectionUnit;
  windowStart: string;
  windowEnd: string;
  occurrenceCount: number;
  sampleCount: number;
};

export type DetectionActivityPoint = {
  at: string;
  healthy: number;
  triggered: number;
  unavailable: number;
};

export type DetectionSnapshot = {
  available: boolean;
  monitoring: boolean;
  message: string | null;
  generatedAt: string;
  cadenceMinutes: number;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunSource: "scheduled" | "manual" | "bootstrap" | null;
  telemetryWatermark: string | null;
  telemetryFreshnessSeconds: number | null;
  servicesMonitored: number;
  detectors: DetectorEvaluation[];
  activeIncidents: DetectionIncident[];
  activity: DetectionActivityPoint[];
};

export type LatencyCandidate = {
  service: string;
  currentP99Ms: number;
  baselineP99Ms: number;
  currentCount: number;
  baselineCount: number;
};

export type ErrorRateCandidate = {
  service: string;
  currentRate: number;
  baselineRate: number;
  currentErrors: number;
  currentCount: number;
  baselineCount: number;
};

type EvaluationContext = {
  evaluatedAt: Date;
  windowStart: Date;
  windowEnd: Date;
  matchedSeries: number;
};

function catalogEntry(detectorId: DetectorId) {
  const entry = DETECTOR_CATALOG.find(
    (candidate) => candidate.id === detectorId,
  );
  if (!entry) throw new Error(`Unknown detector: ${detectorId}`);
  return entry;
}

function baseEvaluation(
  detectorId: DetectorId,
  context: EvaluationContext,
): Pick<
  DetectorEvaluation,
  | "detectorId"
  | "name"
  | "description"
  | "evaluatedAt"
  | "windowStart"
  | "windowEnd"
  | "matchedSeries"
> {
  const detector = catalogEntry(detectorId);
  return {
    detectorId,
    name: detector.name,
    description: detector.description,
    evaluatedAt: context.evaluatedAt.toISOString(),
    windowStart: context.windowStart.toISOString(),
    windowEnd: context.windowEnd.toISOString(),
    matchedSeries: context.matchedSeries,
  };
}

export function evaluateLatencyRegression(
  candidate: LatencyCandidate | null,
  context: EvaluationContext,
): DetectorEvaluation {
  const base = baseEvaluation("latency-regression", context);
  if (!candidate) {
    return {
      ...base,
      status: "no_data",
      severity: "none",
      service: null,
      observed: null,
      baseline: null,
      threshold: null,
      unit: "ms",
      finding: "Waiting for enough spans to establish a latency baseline.",
      sampleCount: 0,
    };
  }

  const threshold = Math.max(250, candidate.baselineP99Ms * 1.8);
  const delta = candidate.currentP99Ms - candidate.baselineP99Ms;
  const ratio =
    candidate.baselineP99Ms > 0
      ? candidate.currentP99Ms / candidate.baselineP99Ms
      : 0;
  const triggered = candidate.currentP99Ms >= threshold && delta >= 100;

  return {
    ...base,
    status: triggered ? "triggered" : "healthy",
    severity: triggered
      ? candidate.currentP99Ms >= 1_000 || ratio >= 3
        ? "critical"
        : "high"
      : "none",
    service: candidate.service,
    observed: candidate.currentP99Ms,
    baseline: candidate.baselineP99Ms,
    threshold,
    unit: "ms",
    finding: triggered
      ? `${candidate.service} p99 is ${ratio.toFixed(1)}× its rolling baseline.`
      : `${candidate.service} has the largest p99 movement and remains inside its guardrail.`,
    sampleCount: candidate.currentCount + candidate.baselineCount,
  };
}

export function evaluateErrorRateSpike(
  candidate: ErrorRateCandidate | null,
  context: EvaluationContext,
): DetectorEvaluation {
  const base = baseEvaluation("error-rate-spike", context);
  if (!candidate) {
    return {
      ...base,
      status: "no_data",
      severity: "none",
      service: null,
      observed: null,
      baseline: null,
      threshold: null,
      unit: "percent",
      finding: "Waiting for enough spans to establish an error-rate baseline.",
      sampleCount: 0,
    };
  }

  const threshold = Math.max(0.03, candidate.baselineRate * 2);
  const triggered =
    candidate.currentErrors >= 5 && candidate.currentRate >= threshold;

  return {
    ...base,
    status: triggered ? "triggered" : "healthy",
    severity: triggered
      ? candidate.currentRate >= 0.2
        ? "critical"
        : "high"
      : "none",
    service: candidate.service,
    observed: candidate.currentRate * 100,
    baseline: candidate.baselineRate * 100,
    threshold: threshold * 100,
    unit: "percent",
    finding: triggered
      ? `${candidate.service} error rate reached ${(candidate.currentRate * 100).toFixed(1)}%.`
      : `${candidate.service} has the highest recent error rate and remains inside its guardrail.`,
    sampleCount: candidate.currentCount + candidate.baselineCount,
  };
}

export function evaluateTelemetryFreshness(
  telemetryWatermark: Date | null,
  context: EvaluationContext,
): DetectorEvaluation {
  const base = baseEvaluation("telemetry-freshness", context);
  if (!telemetryWatermark) {
    return {
      ...base,
      status: "triggered",
      severity: "high",
      service: null,
      observed: null,
      baseline: null,
      threshold: 600,
      unit: "seconds",
      finding: "No OpenTelemetry signals have reached ClickHouse.",
      sampleCount: 0,
    };
  }

  const ageSeconds = Math.max(
    0,
    (context.evaluatedAt.valueOf() - telemetryWatermark.valueOf()) / 1_000,
  );
  const triggered = ageSeconds > 600;

  return {
    ...base,
    status: triggered ? "triggered" : "healthy",
    severity: triggered
      ? ageSeconds > 3_600
        ? "high"
        : "warning"
      : "none",
    service: null,
    observed: ageSeconds,
    baseline: null,
    threshold: 600,
    unit: "seconds",
    finding: triggered
      ? `Telemetry ingestion is ${formatDuration(ageSeconds)} behind.`
      : `Telemetry arrived ${formatDuration(ageSeconds)} ago.`,
    sampleCount: 0,
  };
}

export function detectorErrorEvaluation(
  detectorId: DetectorId,
  message: string,
  context: EvaluationContext,
): DetectorEvaluation {
  const base = baseEvaluation(detectorId, context);
  const unit: DetectionUnit =
    detectorId === "latency-regression"
      ? "ms"
      : detectorId === "error-rate-spike"
        ? "percent"
        : "seconds";
  return {
    ...base,
    status: "error",
    severity: "none",
    service: null,
    observed: null,
    baseline: null,
    threshold: null,
    unit,
    finding: message,
    sampleCount: 0,
  };
}

export function emptyDetectorEvaluation(
  detectorId: DetectorId,
  now = new Date(),
): DetectorEvaluation {
  const detector = catalogEntry(detectorId);
  return {
    detectorId,
    name: detector.name,
    description: detector.description,
    status: "no_data",
    severity: "none",
    service: null,
    observed: null,
    baseline: null,
    threshold: null,
    unit:
      detectorId === "latency-regression"
        ? "ms"
        : detectorId === "error-rate-spike"
          ? "percent"
          : "seconds",
    finding: "Waiting for the first scheduled scan.",
    evaluatedAt: now.toISOString(),
    windowStart: now.toISOString(),
    windowEnd: now.toISOString(),
    matchedSeries: 0,
    sampleCount: 0,
  };
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "unknown";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h`;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.round((seconds % 86_400) / 3_600);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

export function nextDetectionRun(now = new Date()) {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  const minutes = next.getUTCMinutes();
  const remainder = minutes % DETECTION_CADENCE_MINUTES;
  next.setUTCMinutes(
    minutes + (remainder === 0 ? DETECTION_CADENCE_MINUTES : DETECTION_CADENCE_MINUTES - remainder),
  );
  return next;
}
