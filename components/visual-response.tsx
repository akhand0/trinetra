"use client";

import {
  BrainCircuit,
  Focus,
  GitCompareArrows,
  Layers3,
  Maximize2,
  Minimize2,
  ScanSearch,
  Sparkles,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  safeParseChartSpec,
  safeParseHeatmapSpec,
  safeParseMetricSpec,
  safeParseTableSpec,
  safeParseTraceSpec,
} from "@/lib/telemetry/chart-spec";
import {
  ChartSpecView,
  HeatmapSpecView,
  MetricGrid,
  TableExplorer,
  TraceSpecView,
  type VisualInteraction,
} from "@/components/visualizations";
import {
  safeParseVisualResponse,
  type VisualPanel,
} from "@/lib/telemetry/visual-response";
import { VisualReportControl } from "@/components/visual-report-control";
import { VisualShareControl } from "@/components/visual-share-control";
import {
  selectionShortLabel,
  visualPanelLinkState,
  type InvestigationAction,
  type InvestigationSelection,
} from "@/lib/telemetry/investigation-selection";

export type VisualPanelPayload = {
  title?: string;
  eyebrow?: string;
  finding?: string;
  status?: "running" | "complete";
  spec?: unknown;
  table?: unknown;
  metrics?: unknown;
  heatmap?: unknown;
  trace?: unknown;
  source?: string;
};

export function VisualResponse({
  data,
  responseId,
  panelId,
  selection,
  onSelectionChange,
}: {
  data: VisualPanelPayload;
  responseId?: string;
  panelId?: string;
  selection?: InvestigationSelection | null;
  onSelectionChange?: (selection: InvestigationSelection | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const chart = safeParseChartSpec(data.spec);
  const table = safeParseTableSpec(data.table);
  const metrics = safeParseMetricSpec(data.metrics);
  const heatmap = safeParseHeatmapSpec(data.heatmap);
  const trace = safeParseTraceSpec(data.trace);
  const title =
    data.title ??
    chart?.title ??
    table?.title ??
    metrics?.title ??
    heatmap?.title ??
    trace?.title ??
    "Visual answer";
  const hasVisual = Boolean(chart || table || metrics || heatmap || trace);
  const interaction: VisualInteraction | undefined =
    responseId && panelId && onSelectionChange
      ? {
          responseId,
          panelId,
          panelTitle: title,
          source: data.source,
          selection: selection ?? null,
          onSelectionChange,
        }
      : undefined;

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExpanded(false);
      requestAnimationFrame(() => expandButtonRef.current?.focus());
    };
    document.addEventListener("keydown", closeOnEscape);
    requestAnimationFrame(() => expandButtonRef.current?.focus());
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  return (
    <section
      className={`agent-visual-card${expanded ? " expanded" : ""}`}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? title : undefined}
    >
      <header>
        <div>
          <span>
            <Sparkles size={13} /> {data.eyebrow ?? "Visual answer"}
          </span>
          <h2>{title}</h2>
        </div>
        {hasVisual && (
          <button
            ref={expandButtonRef}
            type="button"
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}
      </header>

      <div className="agent-visual-body">
        {chart && <ChartSpecView spec={chart} interaction={interaction} />}
        {table && <TableExplorer spec={table} interaction={interaction} />}
        {metrics && <MetricGrid spec={metrics} interaction={interaction} />}
        {heatmap && (
          <HeatmapSpecView spec={heatmap} interaction={interaction} />
        )}
        {trace && <TraceSpecView spec={trace} interaction={interaction} />}
        {!hasVisual && (
          <div
            className={
              data.status === "running"
                ? "agent-visual-loading"
                : "agent-visual-invalid"
            }
          >
            {data.status === "running" ? <i /> : <Layers3 size={20} />}
            <span>
              {data.status === "running"
                ? "Building the visual response…"
                : data.finding || "This visual could not be validated"}
            </span>
          </div>
        )}
      </div>

      {hasVisual && data.finding && (
        <footer>
          <Sparkles size={13} />
          <span>{data.finding}</span>
          {data.source && <small>{data.source}</small>}
        </footer>
      )}
    </section>
  );
}

function panelPayload(panel: VisualPanel): VisualPanelPayload {
  if (panel.kind === "chart") {
    return { ...panel, status: "complete", spec: panel.spec };
  }
  if (panel.kind === "table") {
    return { ...panel, status: "complete", table: panel.table };
  }
  if (panel.kind === "heatmap") {
    return { ...panel, status: "complete", heatmap: panel.heatmap };
  }
  if (panel.kind === "trace") {
    return { ...panel, status: "complete", trace: panel.trace };
  }
  return { ...panel, status: "complete", metrics: panel.metrics };
}

export function VisualResponseGroup({
  data,
  query,
  onInvestigate,
  disabled = false,
  speaking = false,
  speechSupported = false,
  onToggleSpeech,
  mode = "chat",
}: {
  data: unknown;
  query?: string;
  onInvestigate?: (
    action: InvestigationAction,
    selection: InvestigationSelection,
    originalQuery: string,
  ) => void;
  disabled?: boolean;
  speaking?: boolean;
  speechSupported?: boolean;
  onToggleSpeech?: () => void;
  mode?: "chat" | "shared";
}) {
  const [selection, setSelection] = useState<InvestigationSelection | null>(
    null,
  );
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const response = safeParseVisualResponse(data);
  const activeSelection =
    selection &&
    response &&
    selection.responseId === response.id &&
    response.panels.some((panel) => panel.id === selection.panelId)
      ? selection
      : null;

  useEffect(() => {
    if (!activeSelection || mode !== "chat" || !onInvestigate) return;
    requestAnimationFrame(() =>
      firstActionRef.current?.focus({ preventScroll: true }),
    );
  }, [activeSelection, mode, onInvestigate]);

  if (!response) {
    return (
      <section className="agent-visual-response invalid" role="alert">
        <Layers3 size={20} />
        The multi-panel response could not be validated.
      </section>
    );
  }

  const reportQuery = response.query ?? query;
  const sharedResponse =
    reportQuery && !response.query
      ? { ...response, query: reportQuery }
      : response;
  const panelStates = response.panels.map((panel) => ({
    panel,
    linkState: visualPanelLinkState(panel, activeSelection),
  }));
  const linkedViews = panelStates.filter(
    ({ linkState }) => linkState === "linked",
  ).length;

  return (
    <section className="agent-visual-response">
      <header>
        <div className="agent-response-heading">
          <span>
            <BrainCircuit size={14} /> Adaptive investigation
          </span>
          <h2>{response.title}</h2>
          <p>{response.verdict}</p>
        </div>
        <div className="agent-response-tools">
          <div className="agent-specialists" aria-label="Investigation specialists">
            {response.specialists.map((specialist) => (
              <span key={specialist}>{specialist}</span>
            ))}
          </div>
          {response.status === "complete" && mode === "chat" && (
            <div className="agent-response-action-row">
              {onToggleSpeech && (
                <button
                  type="button"
                  className={`agent-speak-findings${speaking ? " speaking" : ""}`}
                  aria-label={
                    speaking
                      ? "Stop speaking findings"
                      : "Speak findings aloud"
                  }
                  aria-pressed={speaking}
                  disabled={!speechSupported}
                  title={
                    speechSupported
                      ? undefined
                      : "Spoken findings are unavailable in this browser"
                  }
                  onClick={onToggleSpeech}
                >
                  {speaking ? (
                    <Square size={13} fill="currentColor" />
                  ) : (
                    <Volume2 size={14} />
                  )}
                  <span>{speaking ? "Stop speaking" : "Speak findings"}</span>
                </button>
              )}
              <VisualShareControl response={sharedResponse} />
              {reportQuery && <VisualReportControl query={reportQuery} />}
            </div>
          )}
          {onToggleSpeech && (
            <span
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {speaking ? "Reading investigation findings aloud." : ""}
            </span>
          )}
        </div>
      </header>

      {activeSelection && (
        <div
          className={`visual-investigation-shelf${
            mode === "shared" ? " read-only" : ""
          }`}
          role="region"
          aria-label="Point-and-investigate controls"
        >
          <div className="visual-selection-summary" aria-live="polite">
            <i aria-hidden="true">
              <Focus size={17} />
            </i>
            <span>Canvas focus</span>
            <strong>{selectionShortLabel(activeSelection)}</strong>
            <small>
              {linkedViews > 0
                ? `${linkedViews} compatible ${linkedViews === 1 ? "view" : "views"} linked`
                : mode === "shared"
                  ? "Explore this shared snapshot"
                  : "Focused follow-up ready"}
            </small>
          </div>
          <div className="visual-investigation-actions">
            {mode === "chat" && onInvestigate && (
              <>
                <button
                  ref={firstActionRef}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onInvestigate(
                      "explain",
                      activeSelection,
                      reportQuery ?? "",
                    )
                  }
                >
                  <Sparkles size={14} /> Explain
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onInvestigate(
                      "compare",
                      activeSelection,
                      reportQuery ?? "",
                    )
                  }
                >
                  <GitCompareArrows size={14} /> Compare
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onInvestigate(
                      "find_evidence",
                      activeSelection,
                      reportQuery ?? "",
                    )
                  }
                >
                  <ScanSearch size={14} /> Find evidence
                </button>
              </>
            )}
            <button
              type="button"
              className="visual-selection-clear"
              aria-label="Clear canvas selection"
              onClick={() => setSelection(null)}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {response.status === "running" ? (
        <div className="agent-team-progress" role="status">
          {response.specialists.map((specialist, index) => (
            <div key={specialist}>
              <i style={{ animationDelay: `${index * 140}ms` }} />
              <span>{specialist}</span>
              <small>Inspecting ClickHouse…</small>
            </div>
          ))}
        </div>
      ) : response.panels.length > 0 ? (
        <div className="agent-response-grid">
          {panelStates.map(({ panel, linkState }) => (
            <div
              className={`agent-response-panel level-${panel.level} span-${panel.span} selection-${linkState}`}
              key={panel.id}
            >
              <VisualResponse
                data={panelPayload(panel)}
                responseId={response.id}
                panelId={panel.id}
                selection={activeSelection}
                onSelectionChange={setSelection}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="agent-response-empty">
          <Layers3 size={20} />
          The investigators could not validate a visual from this data.
        </div>
      )}
    </section>
  );
}
