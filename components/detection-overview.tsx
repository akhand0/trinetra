"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getDetectionSnapshot,
  runDetectorsNow,
} from "@/app/actions";
import {
  formatDuration,
  type DetectionIncident,
  type DetectionSnapshot,
  type DetectorEvaluation,
} from "@/lib/telemetry/detectors";

type DetectionOverviewProps = {
  initialSnapshot: DetectionSnapshot;
  disabled?: boolean;
  onInvestigate: (prompt: string) => void;
};

function metricValue(
  value: number | null,
  unit: DetectorEvaluation["unit"],
) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "percent") return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  if (unit === "seconds") return formatDuration(value);
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}s`;
  return `${value.toFixed(value >= 100 ? 0 : 1)}ms`;
}

function snapshotAge(snapshot: DetectionSnapshot, value: string | null) {
  if (!value) return "not yet";
  const seconds = Math.max(
    0,
    (Date.parse(snapshot.generatedAt) - Date.parse(value)) / 1_000,
  );
  return `${formatDuration(seconds)} ago`;
}

function nextRunLabel(snapshot: DetectionSnapshot) {
  const seconds = Math.max(
    0,
    (Date.parse(snapshot.nextRunAt) - Date.parse(snapshot.generatedAt)) / 1_000,
  );
  return `next scan in ${formatDuration(seconds)}`;
}

function statusLabel(detector: DetectorEvaluation) {
  if (detector.status === "triggered") return "Firing";
  if (detector.status === "healthy") return "Healthy";
  if (detector.status === "error") return "Query failed";
  return "Waiting";
}

function IncidentCard({
  incident,
  expanded,
  disabled,
  onExpand,
  onInvestigate,
}: {
  incident: DetectionIncident;
  expanded: boolean;
  disabled: boolean;
  onExpand: () => void;
  onInvestigate: () => void;
}) {
  const scaleMax =
    Math.max(
      incident.observed ?? 0,
      incident.threshold ?? 0,
      incident.baseline ?? 0,
      1,
    ) * 1.12;
  const observedWidth = Math.min(
    100,
    ((incident.observed ?? 0) / scaleMax) * 100,
  );
  const thresholdPosition = Math.min(
    100,
    ((incident.threshold ?? 0) / scaleMax) * 100,
  );
  const baselinePosition = Math.min(
    100,
    ((incident.baseline ?? 0) / scaleMax) * 100,
  );

  return (
    <li>
      <article
        className={`detection-incident severity-${incident.severity}${
          expanded ? " expanded" : ""
        }`}
      >
        <button
          type="button"
          className="detection-incident-summary"
          aria-expanded={expanded}
          onClick={onExpand}
        >
          <span className="detection-severity-icon" aria-hidden="true">
            <AlertTriangle size={15} />
          </span>
          <span className="detection-incident-copy">
            <small>{incident.severity} · automatically detected</small>
            <strong>{incident.title}</strong>
            <span>{incident.summary}</span>
          </span>
          <span className="detection-observation">
            <small>Observed</small>
            <b>{metricValue(incident.observed, incident.unit)}</b>
            <em>{incident.service ?? "telemetry pipeline"}</em>
          </span>
          <ChevronDown size={17} className="detection-expand-icon" />
        </button>

        {expanded && (
          <div className="detection-incident-details">
            <figure
              className="detection-guardrail-visual"
              aria-label={`Observed ${metricValue(
                incident.observed,
                incident.unit,
              )}; guardrail ${metricValue(
                incident.threshold,
                incident.unit,
              )}; baseline ${metricValue(incident.baseline, incident.unit)}`}
            >
              <figcaption>
                <span>Signal vs guardrail</span>
                <em>{metricValue(incident.observed, incident.unit)}</em>
              </figcaption>
              <div aria-hidden="true">
                <i style={{ width: `${observedWidth}%` }} />
                {incident.threshold !== null && (
                  <b
                    className="threshold"
                    style={{ left: `${thresholdPosition}%` }}
                  />
                )}
                {incident.baseline !== null && (
                  <b
                    className="baseline"
                    style={{ left: `${baselinePosition}%` }}
                  />
                )}
              </div>
            </figure>
            <dl>
              <div>
                <dt>Baseline</dt>
                <dd>{metricValue(incident.baseline, incident.unit)}</dd>
              </div>
              <div>
                <dt>Guardrail</dt>
                <dd>{metricValue(incident.threshold, incident.unit)}</dd>
              </div>
              <div>
                <dt>Samples</dt>
                <dd>{incident.sampleCount.toLocaleString("en-GB")}</dd>
              </div>
              <div>
                <dt>Observed runs</dt>
                <dd>{incident.occurrenceCount}</dd>
              </div>
            </dl>
            <div>
              <span>
                Evidence window
                <time dateTime={incident.windowStart}>
                  {incident.windowStart.slice(11, 16)} UTC
                </time>
                –
                <time dateTime={incident.windowEnd}>
                  {incident.windowEnd.slice(11, 16)} UTC
                </time>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={onInvestigate}
              >
                <Search size={14} />
                Ask agent
              </button>
            </div>
          </div>
        )}
      </article>
    </li>
  );
}

function DetectorHealth({ detector }: { detector: DetectorEvaluation }) {
  const icon =
    detector.status === "healthy" ? (
      <CheckCircle2 size={14} />
    ) : detector.status === "triggered" ? (
      <AlertTriangle size={14} />
    ) : (
      <Clock3 size={14} />
    );
  return (
    <li className={`detector-health-row status-${detector.status}`}>
      <span aria-hidden="true">{icon}</span>
      <div>
        <strong>{detector.name}</strong>
        <small>{detector.finding}</small>
      </div>
      <em>{statusLabel(detector)}</em>
    </li>
  );
}

export function DetectionOverview({
  initialSnapshot,
  disabled = false,
  onInvestigate,
}: DetectionOverviewProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [expandedIncident, setExpandedIncident] = useState<string | null>(
    initialSnapshot.activeIncidents[0]?.id ?? null,
  );
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let canceled = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await getDetectionSnapshot();
        if (!canceled) setSnapshot(next);
      } catch {
        if (!canceled) setNotice("Could not refresh detector state.");
      }
    };
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, []);

  const healthyDetectors = snapshot.detectors.filter(
    (detector) => detector.status === "healthy",
  ).length;
  const telemetryStale = snapshot.activeIncidents.some(
    (incident) => incident.detectorId === "telemetry-freshness",
  );
  const activity = useMemo(
    () =>
      snapshot.activity.length > 0
        ? snapshot.activity
        : Array.from({ length: 18 }, (_, index) => ({
            at: `pending-${index}`,
            healthy: 0,
            triggered: 0,
            unavailable: 0,
          })),
    [snapshot.activity],
  );

  async function scanNow() {
    if (scanning || !snapshot.available) return;
    setScanning(true);
    setNotice("Running all detectors against ClickHouse…");
    try {
      const next = await runDetectorsNow();
      setSnapshot(next);
      setExpandedIncident((current) =>
        current && next.activeIncidents.some((incident) => incident.id === current)
          ? current
          : next.activeIncidents[0]?.id ?? null,
      );
      setNotice(
        next.activeIncidents.length > 0
          ? `${next.activeIncidents.length} active signal${
              next.activeIncidents.length === 1 ? "" : "s"
            } after the latest scan.`
          : "Latest scan is clear.",
      );
    } catch {
      setNotice("The scan could not complete. Detector state was not changed.");
    } finally {
      setScanning(false);
    }
  }

  function investigate(incident: DetectionIncident) {
    onInvestigate(
      `Investigate always-on incident ${incident.id}: ${incident.title}. ${incident.summary} ` +
        `Use ClickHouse evidence from ${incident.windowStart} to ${incident.windowEnd} and explain the cause visually.`,
    );
  }

  const bannerTitle = !snapshot.available
    ? "Detection needs a ClickHouse connection"
    : telemetryStale
      ? "Telemetry coverage needs attention"
      : snapshot.activeIncidents.length > 0
        ? `${snapshot.activeIncidents.length} active signal${
            snapshot.activeIncidents.length === 1 ? "" : "s"
          } need attention`
        : "No active anomalies";
  const bannerCopy = !snapshot.available
    ? snapshot.message
    : telemetryStale
      ? "The detector loop is healthy, but the OpenTelemetry stream is stale."
      : snapshot.activeIncidents.length > 0
        ? "Trinetra opened and deduplicated these incidents without waiting for a prompt."
        : "Latency, errors, and telemetry freshness are inside their guardrails.";

  return (
    <section
      className={`detection-overview${
        snapshot.activeIncidents.length > 0 ? " has-incidents" : ""
      }`}
      aria-labelledby="detection-title"
      aria-busy={scanning}
    >
      <header className="detection-header">
        <div>
          <span className="detection-kicker">
            <Radar size={15} />
            Always-on detection
            <i className={snapshot.monitoring ? "is-live" : ""} aria-hidden="true" />
          </span>
          <h2 id="detection-title">{bannerTitle}</h2>
          <p>{bannerCopy}</p>
        </div>
        <div className="detection-header-actions">
          <span className="detection-cadence">
            <Clock3 size={13} />
            {snapshot.lastRunAt
              ? `scanned ${snapshotAge(snapshot, snapshot.lastRunAt)}`
              : "first scan pending"}
            <b>·</b>
            {nextRunLabel(snapshot)}
          </span>
          <button
            type="button"
            disabled={!snapshot.available || scanning}
            onClick={() => void scanNow()}
          >
            <RefreshCw size={14} className={scanning ? "spin" : undefined} />
            {scanning ? "Scanning" : "Scan now"}
          </button>
        </div>
      </header>

      <div className="detection-kpis" aria-label="Detection summary">
        <div className={snapshot.activeIncidents.length > 0 ? "attention" : "good"}>
          <span>
            <AlertTriangle size={13} /> Active incidents
          </span>
          <strong>{snapshot.activeIncidents.length}</strong>
          <small>deduplicated signals</small>
        </div>
        <div>
          <span>
            <ShieldCheck size={13} /> Services protected
          </span>
          <strong>{snapshot.servicesMonitored}</strong>
          <small>in the latest window</small>
        </div>
        <div>
          <span>
            <Activity size={13} /> Detectors healthy
          </span>
          <strong>
            {healthyDetectors}
            <em>/{snapshot.detectors.length}</em>
          </strong>
          <small>deterministic checks</small>
        </div>
        <div className={telemetryStale ? "attention" : "good"}>
          <span>
            <Database size={13} /> Telemetry freshness
          </span>
          <strong>
            {snapshot.telemetryFreshnessSeconds === null
              ? "—"
              : formatDuration(snapshot.telemetryFreshnessSeconds)}
          </strong>
          <small>
            {snapshot.telemetryWatermark
              ? `watermark ${snapshot.telemetryWatermark.slice(11, 16)} UTC`
              : "no watermark"}
          </small>
        </div>
      </div>

      <div className="detection-workspace">
        <section className="detection-feed" aria-labelledby="active-detections-title">
          <header>
            <div>
              <h3 id="active-detections-title">Active detections</h3>
              <span>opened automatically from ClickHouse evidence</span>
            </div>
            <b>{snapshot.activeIncidents.length}</b>
          </header>
          {snapshot.activeIncidents.length > 0 ? (
            <ol>
              {snapshot.activeIncidents.map((incident) => (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  expanded={expandedIncident === incident.id}
                  disabled={disabled}
                  onExpand={() =>
                    setExpandedIncident((current) =>
                      current === incident.id ? null : incident.id,
                    )
                  }
                  onInvestigate={() => investigate(incident)}
                />
              ))}
            </ol>
          ) : (
            <div className="detection-clear-state">
              <i aria-hidden="true">
                <CheckCircle2 size={22} />
              </i>
              <div>
                <strong>The current window is clear</strong>
                <span>
                  Trinetra will open an incident here when a guardrail breaks.
                </span>
              </div>
            </div>
          )}
        </section>

        <aside className="detector-health" aria-labelledby="detector-health-title">
          <header>
            <div>
              <h3 id="detector-health-title">Detector health</h3>
              <span>zero-AI monitoring loop</span>
            </div>
            <Radar size={16} />
          </header>
          <ul>
            {snapshot.detectors.map((detector) => (
              <DetectorHealth key={detector.detectorId} detector={detector} />
            ))}
          </ul>
        </aside>
      </div>

      <footer className="detection-activity">
        <div>
          <Sparkles size={13} />
          <span>
            <strong>Signal activity</strong>
            last {snapshot.activity.length || 0} completed scans
          </span>
        </div>
        <div
          className={snapshot.activity.length === 0 ? "is-empty" : ""}
          aria-label={
            snapshot.activity.length > 0
              ? `${snapshot.activity.length} scan history points`
              : "Scan history will appear after the first run"
          }
        >
          {activity.map((point) => (
            <i
              key={point.at}
              className={
                point.triggered > 0
                  ? "triggered"
                  : point.unavailable > 0
                    ? "unavailable"
                    : point.healthy > 0
                      ? "healthy"
                      : ""
              }
              title={
                point.at.startsWith("pending")
                  ? undefined
                  : `${point.at}: ${point.triggered} firing, ${point.healthy} healthy`
              }
            />
          ))}
        </div>
        <span className="detection-source">
          <Database size={12} />
          ClickHouse
        </span>
      </footer>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {notice}
      </p>
    </section>
  );
}
