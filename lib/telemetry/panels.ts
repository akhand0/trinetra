import type { PanelData, Posterior, ProbeArm } from "@/lib/types";

/**
 * Presentation scaffolding for each probe arm: the panel kind, accent, and
 * label the UI needs to render a result. These carry no telemetry — every
 * number, series, finding, and stat is filled in from live ClickHouse reads.
 */
const PANEL_TEMPLATES: Record<
  ProbeArm,
  Pick<PanelData, "id" | "kind" | "arm" | "eyebrow" | "accent">
> = {
  latency_shift: {
    id: "panel-latency",
    kind: "timeline",
    arm: "latency_shift",
    eyebrow: "Latency shift",
    accent: "orange",
  },
  error_cluster: {
    id: "panel-heatmap",
    kind: "heatmap",
    arm: "error_cluster",
    eyebrow: "Error cluster",
    accent: "red",
  },
  deploy_correlation: {
    id: "panel-deploy",
    kind: "deploy",
    arm: "deploy_correlation",
    eyebrow: "Deploy correlation",
    accent: "violet",
  },
  trace_mining: {
    id: "panel-trace",
    kind: "trace",
    arm: "trace_mining",
    eyebrow: "Culprit trace",
    accent: "cyan",
  },
  cardinality_scan: {
    id: "panel-cardinality",
    kind: "cardinality",
    arm: "cardinality_scan",
    eyebrow: "Cardinality scan",
    accent: "green",
  },
};

export const ARM_LABELS: Record<ProbeArm, string> = {
  latency_shift: "Latency",
  error_cluster: "Errors",
  deploy_correlation: "Deploy",
  trace_mining: "Trace",
  cardinality_scan: "Cardinality",
};

/** Builds an empty panel for an arm, ready to be filled with live findings. */
export function panelTemplate(arm: ProbeArm): PanelData {
  return {
    ...PANEL_TEMPLATES[arm],
    title: "",
    summary: "",
    confidence: 0,
    sampledScore: 0,
    propensity: 0,
    finding: "",
  };
}

/** Uniform Beta(1,1) priors — the honest starting point before any rewards. */
export function uniformPriors(): Posterior[] {
  return (Object.keys(PANEL_TEMPLATES) as ProbeArm[]).map((arm) => ({
    arm,
    label: ARM_LABELS[arm],
    alpha: 1,
    beta: 1,
    mean: 0.5,
    sampled: 0.5,
    trials: 0,
  }));
}
