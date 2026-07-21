"use client";

import {
  BrainCircuit,
  Layers3,
  Maximize2,
  Minimize2,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import {
  safeParseChartSpec,
  safeParseMetricSpec,
  safeParseTableSpec,
} from "@/lib/telemetry/chart-spec";
import {
  ChartSpecView,
  MetricGrid,
  TableExplorer,
} from "@/components/visualizations";
import {
  safeParseVisualResponse,
  type VisualPanel,
} from "@/lib/telemetry/visual-response";

export type VisualPanelPayload = {
  title?: string;
  eyebrow?: string;
  finding?: string;
  status?: "running" | "complete";
  spec?: unknown;
  table?: unknown;
  metrics?: unknown;
  source?: string;
};

export function VisualResponse({ data }: { data: VisualPanelPayload }) {
  const [expanded, setExpanded] = useState(false);
  const chart = safeParseChartSpec(data.spec);
  const table = safeParseTableSpec(data.table);
  const metrics = safeParseMetricSpec(data.metrics);
  const title =
    data.title ?? chart?.title ?? table?.title ?? metrics?.title ?? "Visual answer";
  const hasVisual = Boolean(chart || table || metrics);

  return (
    <section className={`agent-visual-card${expanded ? " expanded" : ""}`}>
      <header>
        <div>
          <span>
            <Sparkles size={13} /> {data.eyebrow ?? "Visual answer"}
          </span>
          <h2>{title}</h2>
        </div>
        {hasVisual && (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}
      </header>

      <div className="agent-visual-body">
        {chart && <ChartSpecView spec={chart} />}
        {table && <TableExplorer spec={table} />}
        {metrics && <MetricGrid spec={metrics} />}
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
  return { ...panel, status: "complete", metrics: panel.metrics };
}

export function VisualResponseGroup({ data }: { data: unknown }) {
  const response = safeParseVisualResponse(data);

  if (!response) {
    return (
      <section className="agent-visual-response invalid" role="alert">
        <Layers3 size={20} />
        The multi-panel response could not be validated.
      </section>
    );
  }

  return (
    <section className="agent-visual-response">
      <header>
        <div className="agent-response-heading">
          <span>
            <BrainCircuit size={14} /> Multi-agent investigation
          </span>
          <h2>{response.title}</h2>
          <p>{response.verdict}</p>
        </div>
        <div className="agent-specialists" aria-label="Investigation specialists">
          {response.specialists.map((specialist) => (
            <span key={specialist}>{specialist}</span>
          ))}
        </div>
      </header>

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
          {response.panels.map((panel) => (
            <div
              className={`agent-response-panel level-${panel.level} span-${panel.span}`}
              key={panel.id}
            >
              <VisualResponse data={panelPayload(panel)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="agent-response-empty">
          <Layers3 size={20} />
          No visual was supportable from the available ClickHouse data.
        </div>
      )}
    </section>
  );
}
