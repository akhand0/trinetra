import { describe, expect, it } from "vitest";
import {
  safeParseHeatmapSpec,
  safeParseMetricSpec,
  safeParseTableSpec,
  safeParseTraceSpec,
} from "@/lib/telemetry/chart-spec";
import {
  safeParseVisualResponse,
  tableSubmissionSchema,
} from "@/lib/telemetry/visual-response";
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
        },
        {
          id: "verification",
          label: "Signal verifier",
          objective:
            "Check whether the dominant concentration survives comparison with adjacent telemetry.",
          level: "evidence",
          span: "half",
        },
      ],
    });

    expect(result.success && result.data.specialists).toHaveLength(2);
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
});
