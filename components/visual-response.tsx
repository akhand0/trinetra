"use client";

import { Maximize2, Minimize2, Sparkles } from "lucide-react";
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

export type VisualPanelPayload = {
  title?: string;
  eyebrow?: string;
  finding?: string;
  status?: "running" | "complete";
  spec?: unknown;
  table?: unknown;
  metrics?: unknown;
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
          <div className="agent-visual-loading">
            <i />
            <span>
              {data.status === "running"
                ? "Building the visual response…"
                : data.finding || "Visual probe complete"}
            </span>
          </div>
        )}
      </div>

      {hasVisual && data.finding && (
        <footer>
          <Sparkles size={13} />
          <span>{data.finding}</span>
        </footer>
      )}
    </section>
  );
}
