import { createHash, randomUUID } from "node:crypto";
import { clickhouse, hasClickHouseConfig } from "@/lib/clickhouse/client";
import {
  DETECTION_BASELINE_MINUTES,
  DETECTION_CADENCE_MINUTES,
  DETECTION_WINDOW_MINUTES,
  DETECTOR_CATALOG,
  detectorErrorEvaluation,
  emptyDetectorEvaluation,
  evaluateErrorRateSpike,
  evaluateLatencyRegression,
  evaluateTelemetryFreshness,
  nextDetectionRun,
  type DetectionActivityPoint,
  type DetectionIncident,
  type DetectionSeverity,
  type DetectionSnapshot,
  type DetectorEvaluation,
  type DetectorId,
  type ErrorRateCandidate,
  type LatencyCandidate,
} from "@/lib/telemetry/detectors";

const DETECTOR_RUNS_TABLE = "trinetra_detector_runs";
const INCIDENTS_TABLE = "trinetra_detection_incidents";
const ACTIVITY_LIMIT = 108;

let ensureDetectionTablesPromise: Promise<void> | null = null;

type DetectionCycleSource = "scheduled" | "manual" | "bootstrap";

type DetectorRunRow = {
  evaluated_at: string;
  cycle_id: string;
  detector_id: DetectorId;
  detector_name: string;
  detector_description: string;
  status: DetectorEvaluation["status"];
  severity: DetectionSeverity;
  service: string;
  observed: number | null;
  baseline: number | null;
  threshold: number | null;
  unit: DetectorEvaluation["unit"];
  finding: string;
  window_start: string;
  window_end: string;
  matched_series: number;
  sample_count: number;
  services_monitored: number;
  telemetry_watermark: string | null;
  source: DetectionCycleSource;
};

type IncidentRow = {
  incident_id: string;
  fingerprint: string;
  detector_id: DetectorId;
  opened_at: string;
  last_seen_at: string;
  updated_at: string;
  status: "open" | "resolved";
  severity: Exclude<DetectionSeverity, "none">;
  service: string;
  title: string;
  summary: string;
  observed: number | null;
  baseline: number | null;
  threshold: number | null;
  unit: DetectorEvaluation["unit"];
  window_start: string;
  window_end: string;
  occurrence_count: number;
  sample_count: number;
  cycle_id: string;
  version: number;
};

type TelemetryTableSummary = {
  watermark: Date | null;
  count: number;
};

function clickHouseDate(date: Date) {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function storedDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const withoutZone = value.replace(/Z$/, "");
  const [datePart, fractional = ""] = withoutZone.split(".");
  const normalized = `${datePart.replace(" ", "T")}${
    fractional ? `.${fractional.slice(0, 3).padEnd(3, "0")}` : ""
  }Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 220)
    : "The detector query failed.";
}

function severityRank(severity: DetectionSeverity) {
  if (severity === "critical") return 3;
  if (severity === "high") return 2;
  if (severity === "warning") return 1;
  return 0;
}

function incidentFingerprint(evaluation: DetectorEvaluation) {
  const entity = evaluation.service?.trim().toLowerCase() || "telemetry-pipeline";
  return createHash("sha256")
    .update(`${evaluation.detectorId}\0${entity}`)
    .digest("hex");
}

function incidentId(fingerprint: string, openedAt: string) {
  return `det_${createHash("sha256")
    .update(`${fingerprint}\0${openedAt}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function incidentTitle(evaluation: DetectorEvaluation) {
  if (evaluation.detectorId === "telemetry-freshness") {
    return "Telemetry ingestion is stale";
  }
  if (evaluation.detectorId === "latency-regression") {
    return `${evaluation.service ?? "Service"} latency regression`;
  }
  return `${evaluation.service ?? "Service"} error-rate spike`;
}

async function ensureDetectionTables() {
  if (!hasClickHouseConfig()) {
    throw new Error("ClickHouse is not configured");
  }

  if (!ensureDetectionTablesPromise) {
    ensureDetectionTablesPromise = (async () => {
      await clickhouse().command({
        query: `
          CREATE TABLE IF NOT EXISTS ${DETECTOR_RUNS_TABLE}
          (
            evaluated_at DateTime64(3, 'UTC'),
            cycle_id String,
            detector_id LowCardinality(String),
            detector_name String,
            detector_description String,
            status LowCardinality(String),
            severity LowCardinality(String),
            service String,
            observed Nullable(Float64),
            baseline Nullable(Float64),
            threshold Nullable(Float64),
            unit LowCardinality(String),
            finding String,
            window_start DateTime64(3, 'UTC'),
            window_end DateTime64(3, 'UTC'),
            matched_series UInt32,
            sample_count UInt64,
            services_monitored UInt32,
            telemetry_watermark Nullable(DateTime64(3, 'UTC')),
            source LowCardinality(String)
          )
          ENGINE = MergeTree
          PARTITION BY toDate(evaluated_at)
          ORDER BY (detector_id, evaluated_at, cycle_id)
          TTL evaluated_at + INTERVAL 30 DAY DELETE
        `,
      });

      await clickhouse().command({
        query: `
          CREATE TABLE IF NOT EXISTS ${INCIDENTS_TABLE}
          (
            incident_id String,
            fingerprint FixedString(64),
            detector_id LowCardinality(String),
            opened_at DateTime64(3, 'UTC'),
            last_seen_at DateTime64(3, 'UTC'),
            updated_at DateTime64(3, 'UTC'),
            status LowCardinality(String),
            severity LowCardinality(String),
            service String,
            title String,
            summary String,
            observed Nullable(Float64),
            baseline Nullable(Float64),
            threshold Nullable(Float64),
            unit LowCardinality(String),
            window_start DateTime64(3, 'UTC'),
            window_end DateTime64(3, 'UTC'),
            occurrence_count UInt32,
            sample_count UInt64,
            cycle_id String,
            version UInt64
          )
          ENGINE = ReplacingMergeTree(version)
          ORDER BY incident_id
        `,
      });
    })().catch((error) => {
      ensureDetectionTablesPromise = null;
      throw error;
    });
  }

  await ensureDetectionTablesPromise;
}

async function availableTelemetryViews() {
  const result = await clickhouse().query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = currentDatabase()
        AND name IN ('spans', 'logs')
    `,
    format: "JSONEachRow",
  });
  const rows = await result.json<{ name: string }>();
  return new Set(rows.map((row) => row.name));
}

async function telemetryTableSummary(
  table: "spans" | "logs",
): Promise<TelemetryTableSummary> {
  const result = await clickhouse().query({
    query: `
      SELECT
        toString(max(ts)) AS watermark,
        count() AS points
      FROM ${table}
    `,
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ watermark: string; points: number }>();
  const iso = storedDate(row?.watermark);
  return {
    watermark: iso ? new Date(iso) : null,
    count: numberValue(row?.points),
  };
}

async function readTelemetryAnchor() {
  const views = await availableTelemetryViews();
  const summaries = await Promise.all(
    (["spans", "logs"] as const)
      .filter((table) => views.has(table))
      .map((table) => telemetryTableSummary(table)),
  );
  const populated = summaries.filter(
    (summary) => summary.count > 0 && summary.watermark,
  );
  const watermark =
    populated
      .map((summary) => summary.watermark as Date)
      .sort((left, right) => right.valueOf() - left.valueOf())[0] ?? null;

  return {
    views,
    watermark,
    pointCount: summaries.reduce((total, summary) => total + summary.count, 0),
  };
}

async function monitoredServices(
  views: Set<string>,
  anchor: Date,
): Promise<number> {
  if (!views.has("spans") && !views.has("logs")) return 0;
  const sources = [
    views.has("spans")
      ? `SELECT service FROM spans
         WHERE ts > parseDateTime64BestEffort({anchor:String}) - INTERVAL ${DETECTION_BASELINE_MINUTES + DETECTION_WINDOW_MINUTES} MINUTE`
      : null,
    views.has("logs")
      ? `SELECT service FROM logs
         WHERE ts > parseDateTime64BestEffort({anchor:String}) - INTERVAL ${DETECTION_BASELINE_MINUTES + DETECTION_WINDOW_MINUTES} MINUTE`
      : null,
  ].filter(Boolean);
  const result = await clickhouse().query({
    query: `
      SELECT uniqExact(service) AS services
      FROM (${sources.join(" UNION ALL ")})
      WHERE service != ''
    `,
    query_params: { anchor: anchor.toISOString() },
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ services: number }>();
  return numberValue(row?.services);
}

async function readLatencyCandidates(
  anchor: Date,
): Promise<LatencyCandidate[]> {
  const result = await clickhouse().query({
    query: `
      WITH parseDateTime64BestEffort({anchor:String}) AS anchor
      SELECT
        service,
        countIf(ts > anchor - INTERVAL ${DETECTION_WINDOW_MINUTES} MINUTE) AS current_count,
        countIf(
          ts <= anchor - INTERVAL ${DETECTION_WINDOW_MINUTES} MINUTE
          AND ts > anchor - INTERVAL ${DETECTION_BASELINE_MINUTES + DETECTION_WINDOW_MINUTES} MINUTE
        ) AS baseline_count,
        round(quantileIf(0.99)(
          duration_ms,
          ts > anchor - INTERVAL ${DETECTION_WINDOW_MINUTES} MINUTE
        ), 3) AS current_p99,
        round(quantileIf(0.99)(
          duration_ms,
          ts <= anchor - INTERVAL ${DETECTION_WINDOW_MINUTES} MINUTE
          AND ts > anchor - INTERVAL ${DETECTION_BASELINE_MINUTES + DETECTION_WINDOW_MINUTES} MINUTE
        ), 3) AS baseline_p99
      FROM spans
      WHERE ts > anchor - INTERVAL ${DETECTION_BASELINE_MINUTES + DETECTION_WINDOW_MINUTES} MINUTE
        AND ts <= anchor
        AND service != ''
      GROUP BY service
      HAVING current_count >= 20 AND baseline_count >= 100
      ORDER BY greatest(
        current_p99 - greatest(250, baseline_p99 * 1.8),
        (current_p99 + 1) / (baseline_p99 + 1)
      ) DESC
      LIMIT 25
    `,
    query_params: { anchor: anchor.toISOString() },
    format: "JSONEachRow",
  });
  const rows = await result.json<{
    service: string;
    current_count: number;
    baseline_count: number;
    current_p99: number;
    baseline_p99: number;
  }>();
  return rows.map((row) => ({
    service: row.service,
    currentP99Ms: numberValue(row.current_p99),
    baselineP99Ms: numberValue(row.baseline_p99),
    currentCount: numberValue(row.current_count),
    baselineCount: numberValue(row.baseline_count),
  }));
}

async function readErrorRateCandidates(
  anchor: Date,
): Promise<ErrorRateCandidate[]> {
  const result = await clickhouse().query({
    query: `
      WITH parseDateTime64BestEffort({anchor:String}) AS anchor
      SELECT
        service,
        countIf(ts > anchor - INTERVAL ${DETECTION_WINDOW_MINUTES} MINUTE) AS current_count,
        countIf(
          ts > anchor - INTERVAL ${DETECTION_WINDOW_MINUTES} MINUTE
          AND status = 'Error'
        ) AS current_errors,
        countIf(
          ts <= anchor - INTERVAL ${DETECTION_WINDOW_MINUTES} MINUTE
          AND ts > anchor - INTERVAL ${DETECTION_BASELINE_MINUTES + DETECTION_WINDOW_MINUTES} MINUTE
        ) AS baseline_count,
        countIf(
          ts <= anchor - INTERVAL ${DETECTION_WINDOW_MINUTES} MINUTE
          AND ts > anchor - INTERVAL ${DETECTION_BASELINE_MINUTES + DETECTION_WINDOW_MINUTES} MINUTE
          AND status = 'Error'
        ) AS baseline_errors,
        current_errors / greatest(current_count, 1) AS current_rate,
        baseline_errors / greatest(baseline_count, 1) AS baseline_rate
      FROM spans
      WHERE ts > anchor - INTERVAL ${DETECTION_BASELINE_MINUTES + DETECTION_WINDOW_MINUTES} MINUTE
        AND ts <= anchor
        AND service != ''
      GROUP BY service
      HAVING current_count >= 20 AND baseline_count >= 100
      ORDER BY greatest(
        current_rate - greatest(0.03, baseline_rate * 2),
        current_rate
      ) DESC
      LIMIT 25
    `,
    query_params: { anchor: anchor.toISOString() },
    format: "JSONEachRow",
  });
  const rows = await result.json<{
    service: string;
    current_count: number;
    current_errors: number;
    baseline_count: number;
    current_rate: number;
    baseline_rate: number;
  }>();
  return rows.map((row) => ({
    service: row.service,
    currentRate: numberValue(row.current_rate),
    baselineRate: numberValue(row.baseline_rate),
    currentErrors: numberValue(row.current_errors),
    currentCount: numberValue(row.current_count),
    baselineCount: numberValue(row.baseline_count),
  }));
}

function selectLatencyCandidate(candidates: LatencyCandidate[]) {
  return (
    candidates.toSorted((left, right) => {
      const leftThreshold = Math.max(250, left.baselineP99Ms * 1.8);
      const rightThreshold = Math.max(250, right.baselineP99Ms * 1.8);
      return (
        right.currentP99Ms - rightThreshold - (left.currentP99Ms - leftThreshold)
      );
    })[0] ?? null
  );
}

function selectErrorCandidate(candidates: ErrorRateCandidate[]) {
  return (
    candidates.toSorted((left, right) => {
      const leftThreshold = Math.max(0.03, left.baselineRate * 2);
      const rightThreshold = Math.max(0.03, right.baselineRate * 2);
      return right.currentRate - rightThreshold - (left.currentRate - leftThreshold);
    })[0] ?? null
  );
}

async function insertDetectorRuns(input: {
  cycleId: string;
  source: DetectionCycleSource;
  evaluations: DetectorEvaluation[];
  servicesMonitored: number;
  telemetryWatermark: Date | null;
}) {
  await clickhouse().insert({
    table: DETECTOR_RUNS_TABLE,
    format: "JSONEachRow",
    values: input.evaluations.map((evaluation) => ({
      evaluated_at: clickHouseDate(new Date(evaluation.evaluatedAt)),
      cycle_id: input.cycleId,
      detector_id: evaluation.detectorId,
      detector_name: evaluation.name,
      detector_description: evaluation.description,
      status: evaluation.status,
      severity: evaluation.severity,
      service: evaluation.service ?? "",
      observed: evaluation.observed,
      baseline: evaluation.baseline,
      threshold: evaluation.threshold,
      unit: evaluation.unit,
      finding: evaluation.finding,
      window_start: clickHouseDate(new Date(evaluation.windowStart)),
      window_end: clickHouseDate(new Date(evaluation.windowEnd)),
      matched_series: evaluation.matchedSeries,
      sample_count: evaluation.sampleCount,
      services_monitored: input.servicesMonitored,
      telemetry_watermark: input.telemetryWatermark
        ? clickHouseDate(input.telemetryWatermark)
        : null,
      source: input.source,
    })),
  });
}

function rowToIncident(row: IncidentRow): DetectionIncident | null {
  const openedAt = storedDate(row.opened_at);
  const lastSeenAt = storedDate(row.last_seen_at);
  const updatedAt = storedDate(row.updated_at);
  const windowStart = storedDate(row.window_start);
  const windowEnd = storedDate(row.window_end);
  if (!openedAt || !lastSeenAt || !updatedAt || !windowStart || !windowEnd) {
    return null;
  }
  return {
    id: row.incident_id,
    fingerprint: row.fingerprint,
    detectorId: row.detector_id,
    openedAt,
    lastSeenAt,
    updatedAt,
    status: row.status,
    severity: row.severity,
    service: row.service || null,
    title: row.title,
    summary: row.summary,
    observed: row.observed === null ? null : numberValue(row.observed),
    baseline: row.baseline === null ? null : numberValue(row.baseline),
    threshold: row.threshold === null ? null : numberValue(row.threshold),
    unit: row.unit,
    windowStart,
    windowEnd,
    occurrenceCount: numberValue(row.occurrence_count),
    sampleCount: numberValue(row.sample_count),
  };
}

async function readIncidentRows() {
  const result = await clickhouse().query({
    query: `
      SELECT *
      FROM ${INCIDENTS_TABLE} FINAL
      ORDER BY updated_at DESC
      LIMIT 100
    `,
    format: "JSONEachRow",
  });
  return result.json<IncidentRow>();
}

async function insertIncident(row: IncidentRow) {
  await clickhouse().insert({
    table: INCIDENTS_TABLE,
    format: "JSONEachRow",
    values: [
      {
        ...row,
        opened_at: clickHouseDate(new Date(row.opened_at)),
        last_seen_at: clickHouseDate(new Date(row.last_seen_at)),
        updated_at: clickHouseDate(new Date(row.updated_at)),
        window_start: clickHouseDate(new Date(row.window_start)),
        window_end: clickHouseDate(new Date(row.window_end)),
      },
    ],
  });
}

async function updateIncidentLifecycle(
  evaluations: DetectorEvaluation[],
  cycleId: string,
) {
  const current = await readIncidentRows();
  let versionOffset = 0;

  for (const evaluation of evaluations) {
    const activeForDetector = current.filter(
      (incident) =>
        incident.detector_id === evaluation.detectorId &&
        incident.status === "open",
    );

    if (evaluation.status === "triggered") {
      const fingerprint = incidentFingerprint(evaluation);
      const existing = activeForDetector.find(
        (incident) => incident.fingerprint === fingerprint,
      );
      const now = evaluation.evaluatedAt;
      const openedAt =
        storedDate(existing?.opened_at) ?? evaluation.evaluatedAt;
      const severity =
        evaluation.severity === "none" ? "warning" : evaluation.severity;
      await insertIncident({
        incident_id:
          existing?.incident_id ?? incidentId(fingerprint, openedAt),
        fingerprint,
        detector_id: evaluation.detectorId,
        opened_at: openedAt,
        last_seen_at: now,
        updated_at: now,
        status: "open",
        severity,
        service: evaluation.service ?? "",
        title: incidentTitle(evaluation),
        summary: evaluation.finding,
        observed: evaluation.observed,
        baseline: evaluation.baseline,
        threshold: evaluation.threshold,
        unit: evaluation.unit,
        window_start: evaluation.windowStart,
        window_end: evaluation.windowEnd,
        occurrence_count:
          existing?.cycle_id === cycleId
            ? numberValue(existing.occurrence_count, 1)
            : numberValue(existing?.occurrence_count, 0) + 1,
        sample_count: evaluation.sampleCount,
        cycle_id: cycleId,
        version: Date.now() * 1_000 + versionOffset++,
      });

      for (const stale of activeForDetector.filter(
        (incident) => incident.fingerprint !== fingerprint,
      )) {
        await insertIncident({
          ...stale,
          updated_at: now,
          status: "resolved",
          cycle_id: cycleId,
          version: Date.now() * 1_000 + versionOffset++,
        });
      }
      continue;
    }

    if (evaluation.status === "healthy") {
      for (const incident of activeForDetector) {
        await insertIncident({
          ...incident,
          updated_at: evaluation.evaluatedAt,
          status: "resolved",
          cycle_id: cycleId,
          version: Date.now() * 1_000 + versionOffset++,
        });
      }
    }
  }
}

function unavailableSnapshot(message: string): DetectionSnapshot {
  const now = new Date();
  return {
    available: false,
    monitoring: false,
    message,
    generatedAt: now.toISOString(),
    cadenceMinutes: DETECTION_CADENCE_MINUTES,
    nextRunAt: nextDetectionRun(now).toISOString(),
    lastRunAt: null,
    lastRunSource: null,
    telemetryWatermark: null,
    telemetryFreshnessSeconds: null,
    servicesMonitored: 0,
    detectors: DETECTOR_CATALOG.map((detector) =>
      emptyDetectorEvaluation(detector.id, now),
    ),
    activeIncidents: [],
    activity: [],
  };
}

function rowToEvaluation(row: DetectorRunRow): DetectorEvaluation | null {
  const evaluatedAt = storedDate(row.evaluated_at);
  const windowStart = storedDate(row.window_start);
  const windowEnd = storedDate(row.window_end);
  if (!evaluatedAt || !windowStart || !windowEnd) return null;
  return {
    detectorId: row.detector_id,
    name: row.detector_name,
    description: row.detector_description,
    status: row.status,
    severity: row.severity,
    service: row.service || null,
    observed: row.observed === null ? null : numberValue(row.observed),
    baseline: row.baseline === null ? null : numberValue(row.baseline),
    threshold: row.threshold === null ? null : numberValue(row.threshold),
    unit: row.unit,
    finding: row.finding,
    evaluatedAt,
    windowStart,
    windowEnd,
    matchedSeries: numberValue(row.matched_series),
    sampleCount: numberValue(row.sample_count),
  };
}

function activityFromRows(rows: DetectorRunRow[]): DetectionActivityPoint[] {
  const cycles = new Map<string, DetectionActivityPoint>();
  for (const row of rows.toReversed()) {
    const at = storedDate(row.evaluated_at);
    if (!at) continue;
    const point = cycles.get(row.cycle_id) ?? {
      at,
      healthy: 0,
      triggered: 0,
      unavailable: 0,
    };
    if (row.status === "healthy") point.healthy += 1;
    else if (row.status === "triggered") point.triggered += 1;
    else point.unavailable += 1;
    cycles.set(row.cycle_id, point);
  }
  return Array.from(cycles.values()).slice(-36);
}

export async function readDetectionSnapshot(): Promise<DetectionSnapshot> {
  if (!hasClickHouseConfig()) {
    return unavailableSnapshot("Connect ClickHouse to activate detection.");
  }

  try {
    await ensureDetectionTables();
    const [runsResult, incidentRows] = await Promise.all([
      clickhouse().query({
        query: `
          SELECT *
          FROM ${DETECTOR_RUNS_TABLE}
          ORDER BY evaluated_at DESC
          LIMIT ${ACTIVITY_LIMIT}
        `,
        format: "JSONEachRow",
      }),
      readIncidentRows(),
    ]);
    const runRows = await runsResult.json<DetectorRunRow>();
    const latest = new Map<DetectorId, DetectorEvaluation>();
    for (const row of runRows) {
      if (latest.has(row.detector_id)) continue;
      const evaluation = rowToEvaluation(row);
      if (evaluation) latest.set(row.detector_id, evaluation);
    }

    const latestRow = runRows[0];
    const lastRunAt = storedDate(latestRow?.evaluated_at);
    const telemetryWatermark = storedDate(latestRow?.telemetry_watermark);
    const freshness = latest.get("telemetry-freshness");
    const activeIncidents = incidentRows
      .filter((row) => row.status === "open")
      .flatMap((row) => {
        const incident = rowToIncident(row);
        return incident ? [incident] : [];
      })
      .toSorted(
        (left, right) =>
          severityRank(right.severity) - severityRank(left.severity) ||
          Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt),
      );
    const now = new Date();

    return {
      available: true,
      monitoring: true,
      message:
        runRows.length === 0
          ? "Detection is ready and waiting for its first scan."
          : null,
      generatedAt: now.toISOString(),
      cadenceMinutes: DETECTION_CADENCE_MINUTES,
      nextRunAt: nextDetectionRun(now).toISOString(),
      lastRunAt,
      lastRunSource: latestRow?.source ?? null,
      telemetryWatermark,
      telemetryFreshnessSeconds:
        freshness?.observed === null || freshness?.observed === undefined
          ? null
          : freshness.observed,
      servicesMonitored: numberValue(latestRow?.services_monitored),
      detectors: DETECTOR_CATALOG.map(
        (detector) =>
          latest.get(detector.id) ?? emptyDetectorEvaluation(detector.id, now),
      ),
      activeIncidents,
      activity: activityFromRows(runRows),
    };
  } catch (error) {
    console.error("Could not read detection state", error);
    return unavailableSnapshot(
      "Detection state is temporarily unavailable from ClickHouse.",
    );
  }
}

export async function runDetectionCycle(input?: {
  source?: DetectionCycleSource;
  cycleId?: string;
  evaluatedAt?: Date;
}) {
  if (!hasClickHouseConfig()) {
    throw new Error("ClickHouse is not configured");
  }
  await ensureDetectionTables();

  const evaluatedAt = input?.evaluatedAt ?? new Date();
  const cycleId = input?.cycleId ?? randomUUID();
  const source = input?.source ?? "manual";
  const telemetry = await readTelemetryAnchor();
  const anchor = telemetry.watermark ?? evaluatedAt;
  const windowStart = new Date(
    anchor.valueOf() -
      (DETECTION_BASELINE_MINUTES + DETECTION_WINDOW_MINUTES) * 60_000,
  );
  const context = {
    evaluatedAt,
    windowStart,
    windowEnd: anchor,
    matchedSeries: 0,
  };
  const servicesMonitored =
    telemetry.pointCount > 0
      ? await monitoredServices(telemetry.views, anchor)
      : 0;

  let latencyEvaluation: DetectorEvaluation;
  if (!telemetry.views.has("spans") || telemetry.pointCount === 0) {
    latencyEvaluation = evaluateLatencyRegression(null, context);
  } else {
    try {
      const candidates = await readLatencyCandidates(anchor);
      latencyEvaluation = evaluateLatencyRegression(
        selectLatencyCandidate(candidates),
        { ...context, matchedSeries: candidates.length },
      );
    } catch (error) {
      latencyEvaluation = detectorErrorEvaluation(
        "latency-regression",
        errorMessage(error),
        context,
      );
    }
  }

  let errorEvaluation: DetectorEvaluation;
  if (!telemetry.views.has("spans") || telemetry.pointCount === 0) {
    errorEvaluation = evaluateErrorRateSpike(null, context);
  } else {
    try {
      const candidates = await readErrorRateCandidates(anchor);
      errorEvaluation = evaluateErrorRateSpike(
        selectErrorCandidate(candidates),
        { ...context, matchedSeries: candidates.length },
      );
    } catch (error) {
      errorEvaluation = detectorErrorEvaluation(
        "error-rate-spike",
        errorMessage(error),
        context,
      );
    }
  }

  const evaluations = [
    latencyEvaluation,
    errorEvaluation,
    evaluateTelemetryFreshness(telemetry.watermark, context),
  ];
  await insertDetectorRuns({
    cycleId,
    source,
    evaluations,
    servicesMonitored,
    telemetryWatermark: telemetry.watermark,
  });
  await updateIncidentLifecycle(evaluations, cycleId);

  return readDetectionSnapshot();
}
