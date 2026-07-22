import { describe, expect, it } from "vitest";
import {
  effectiveChartSeriesField,
  safeParseChartSpec,
  safeParseHeatmapSpec,
  safeParseMetricSpec,
  safeParseTableSpec,
  safeParseTraceSpec,
} from "@/lib/telemetry/chart-spec";
import {
  MAX_INVESTIGATION_VISUALS,
  safeParseVisualResponse,
  tableSubmissionSchema,
} from "@/lib/telemetry/visual-response";
import {
  submissionToolsForDeliverable,
  visualDeliverableFromAssignment,
  visualKindSupportsDeliverable,
} from "@/lib/telemetry/visual-deliverables";
import { investigationPlanSchema } from "@/trigger/investigation-team";

describe("visual response contracts", () => {
  it("accepts a searchable table payload", () => {
    const spec = safeParseTableSpec({
      title: "ClickHouse tables",
      columns: [
        { key: "name", label: "Table" },
        { key: "engine", label: "Engine" },
      ],
      rows: [{ name: "otel_logs", engine: "SharedMergeTree" }],
      defaultSort: { key: "name", direction: "asc" },
    });

    expect(spec?.rows[0].name).toBe("otel_logs");
  });

  it("rejects unbounded or empty table payloads", () => {
    expect(
      safeParseTableSpec({ title: "Empty", columns: [], rows: [] }),
    ).toBeNull();
  });

  it("defaults metric tones to neutral", () => {
    const spec = safeParseMetricSpec({
      title: "Service health",
      items: [{ label: "Error rate", value: "0.4%" }],
    });

    expect(spec?.items[0].tone).toBe("neutral");
  });

  it.each(["line", "area", "bar", "scatter"] as const)(
    "accepts an agent-composed %s chart",
    (mark) => {
      const spec = safeParseChartSpec({
        mark,
        title: "Latency by minute",
        x: { field: "minute", label: "Minute" },
        y: { field: "p99_ms", label: "p99 (ms)" },
        data: [
          { minute: "10:01", p99_ms: 180 },
          { minute: "10:02", p99_ms: 420 },
        ],
      });

      expect(spec?.mark).toBe(mark);
      expect(spec?.data).toHaveLength(2);
    },
  );

  it("drops a numeric measure mistakenly used as a chart series", () => {
    const spec = safeParseChartSpec({
      mark: "area",
      x: { field: "bucket" },
      y: { field: "spans" },
      series: { field: "spans" },
      data: [
        { bucket: "10:00", spans: 12 },
        { bucket: "11:00", spans: 20 },
      ],
    });

    expect(spec?.series).toBeUndefined();
  });

  it("keeps a categorical series repeated across x values", () => {
    const spec = safeParseChartSpec({
      mark: "line",
      x: { field: "bucket" },
      y: { field: "spans" },
      series: { field: "service" },
      data: [
        { bucket: "10:00", service: "checkout", spans: 12 },
        { bucket: "11:00", service: "checkout", spans: 20 },
        { bucket: "10:00", service: "payment", spans: 8 },
        { bucket: "11:00", service: "payment", spans: 11 },
      ],
    });

    expect(effectiveChartSeriesField(spec!)).toBe("service");
  });

  it("accepts an agent-composed heatmap", () => {
    const spec = safeParseHeatmapSpec({
      title: "Errors by service and minute",
      valueLabel: "errors",
      cells: [
        { row: "payments-api", column: "10:01", value: 2 },
        { row: "payments-api", column: "10:02", value: 19 },
      ],
    });

    expect(spec?.cells[1].value).toBe(19);
  });

  it("accepts an agent-composed trace waterfall", () => {
    const spec = safeParseTraceSpec({
      title: "Slow checkout trace",
      traceId: "trace-1",
      totalDurationMs: 312,
      spans: [
        {
          id: "span-1",
          service: "payments-api",
          operation: "pool.acquire",
          startMs: 45,
          durationMs: 180,
          status: "error",
        },
      ],
    });

    expect(spec?.spans[0].status).toBe("error");
  });

  it("accepts a renderer submission with one visual title", () => {
    const result = tableSubmissionSchema.safeParse({
      finding:
        "Only five error spans exist around the incident window, concentrated in flagd with isolated errors in payment, recommendation, and ad services.",
      source: "ClickHouse otel_traces",
      table: {
        title: "Error spans by service",
        columns: [{ key: "service", label: "Service" }],
        rows: [{ service: "flagd" }],
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a prompt-specific investigation team and layout", () => {
    const result = investigationPlanSchema.safeParse({
      specialists: [
        {
          id: "cluster-map",
          label: "Cluster cartographer",
          objective:
            "Locate the strongest service-by-time concentration around the regression.",
          level: "overview",
          span: "full",
          deliverable: "series",
        },
        {
          id: "verification",
          label: "Signal verifier",
          objective:
            "Check whether the dominant concentration survives comparison with adjacent telemetry.",
          level: "evidence",
          span: "half",
          deliverable: "rows",
        },
      ],
    });

    expect(result.success && result.data.specialists).toHaveLength(2);
  });

  it("lets the planner choose more than three independent visuals", () => {
    const specialists = Array.from({ length: 6 }, (_, index) => ({
      id: `lens-${index}`,
      label: `Investigator ${index + 1}`,
      objective: `Investigate independent telemetry question ${index + 1} with data-backed evidence.`,
      level: index === 0 ? ("overview" as const) : ("analysis" as const),
      span: index === 0 ? ("full" as const) : ("half" as const),
      deliverable: index % 2 === 0 ? ("series" as const) : ("rows" as const),
    }));

    const result = investigationPlanSchema.safeParse({ specialists });

    expect(result.success && result.data.specialists).toHaveLength(6);
    expect(MAX_INVESTIGATION_VISUALS).toBeGreaterThan(3);
  });

  it("preserves every useful panel selected by a larger agent team", () => {
    const panels = Array.from({ length: 7 }, (_, index) => ({
      id: `panel-${index}`,
      kind: "chart" as const,
      level: index === 0 ? ("overview" as const) : ("analysis" as const),
      span: index === 0 ? ("full" as const) : ("half" as const),
      title: `Independent finding ${index + 1}`,
      eyebrow: `Analysis · Lens ${index + 1}`,
      finding: `Finding ${index + 1} is backed by a distinct ClickHouse query.`,
      spec: {
        mark: "line" as const,
        x: { field: "bucket" },
        y: { field: "value" },
        data: [
          { bucket: "10:00", value: index + 1 },
          { bucket: "11:00", value: index + 2 },
        ],
      },
    }));

    const response = safeParseVisualResponse({
      id: "investigation-expanded-team",
      title: "Expanded investigation",
      verdict: "Seven independent views were supported by the data.",
      status: "complete",
      specialists: panels.map((_, index) => `Investigator ${index + 1}`),
      panels,
    });

    expect(response?.panels).toHaveLength(7);
  });

  it("accepts an empty running multi-agent response", () => {
    const response = safeParseVisualResponse({
      id: "investigation-1",
      title: "Investigating incident",
      verdict: "Specialists are querying ClickHouse…",
      status: "running",
      specialists: ["Verdict analyst", "Trend analyst", "Evidence analyst"],
      panels: [],
    });

    expect(response?.status).toBe("running");
  });

  it("preserves overview-to-evidence panel order", () => {
    const response = safeParseVisualResponse({
      id: "investigation-2",
      title: "Incident result",
      verdict: "Payments API regressed after deployment.",
      status: "complete",
      specialists: ["Verdict analyst", "Evidence analyst"],
      panels: [
        {
          id: "overview",
          kind: "metrics",
          level: "overview",
          span: "full",
          title: "Verdict",
          eyebrow: "Overview",
          finding: "Payments API is the culprit.",
          metrics: {
            title: "Verdict",
            items: [{ label: "Service", value: "payments-api" }],
          },
        },
        {
          id: "evidence",
          kind: "table",
          level: "evidence",
          span: "full",
          title: "Evidence",
          eyebrow: "Evidence",
          finding: "Verified label row.",
          table: {
            title: "Evidence",
            columns: [{ key: "service", label: "Service" }],
            rows: [{ service: "payments-api" }],
          },
        },
      ],
    });

    expect(response?.panels.map((panel) => panel.level)).toEqual([
      "overview",
      "evidence",
    ]);
  });

  it("preserves line, bar, and table panels in one investigation", () => {
    const response = safeParseVisualResponse({
      id: "investigation-mixed",
      title: "Payments incident",
      verdict: "Latency rose after the deployment.",
      status: "complete",
      specialists: ["Timeline", "Comparison", "Evidence"],
      panels: [
        {
          id: "timeline",
          kind: "chart",
          level: "overview",
          span: "full",
          title: "p99 over time",
          eyebrow: "Overview · Timeline",
          finding: "p99 rose after 10:02.",
          spec: {
            mark: "line",
            x: { field: "minute" },
            y: { field: "p99_ms" },
            data: [
              { minute: "10:01", p99_ms: 180 },
              { minute: "10:02", p99_ms: 420 },
            ],
          },
        },
        {
          id: "comparison",
          kind: "chart",
          level: "analysis",
          span: "half",
          title: "Errors by service",
          eyebrow: "Analysis · Comparison",
          finding: "payments-api has the most errors.",
          spec: {
            mark: "bar",
            x: { field: "service" },
            y: { field: "errors" },
            data: [
              { service: "payments-api", errors: 42 },
              { service: "checkout", errors: 7 },
            ],
          },
        },
        {
          id: "evidence",
          kind: "table",
          level: "evidence",
          span: "half",
          title: "Slow requests",
          eyebrow: "Evidence · Requests",
          finding: "The slowest rows share the same service.",
          table: {
            title: "Slow requests",
            columns: [
              { key: "service", label: "Service" },
              { key: "duration_ms", label: "Duration (ms)" },
            ],
            rows: [
              { service: "payments-api", duration_ms: 910 },
              { service: "payments-api", duration_ms: 840 },
            ],
          },
        },
      ],
    });

    expect(response?.panels.map((panel) => panel.kind)).toEqual([
      "chart",
      "chart",
      "table",
    ]);
    expect(
      response?.panels
        .filter((panel) => panel.kind === "chart")
        .map((panel) => panel.spec.mark),
    ).toEqual(["line", "bar"]);
  });

  it("keeps specialist renderers inside their assigned data shape", () => {
    expect(submissionToolsForDeliverable("verdict")).toEqual([
      "submitMetrics",
      "submitChart",
    ]);
    expect(submissionToolsForDeliverable("series")).toEqual([
      "submitChart",
      "submitHeatmap",
    ]);
    expect(submissionToolsForDeliverable("rows")).toEqual([
      "submitTable",
      "submitTrace",
    ]);
    expect(visualKindSupportsDeliverable("series", "metrics")).toBe(false);
    expect(visualKindSupportsDeliverable("rows", "table")).toBe(true);
    expect(
      visualDeliverableFromAssignment("DELIVERABLE: series\nUSER PROMPT: why slow?"),
    ).toBe("series");
  });
});
