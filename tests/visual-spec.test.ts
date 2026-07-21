import { describe, expect, it } from "vitest";
import {
  safeParseMetricSpec,
  safeParseTableSpec,
} from "@/lib/telemetry/chart-spec";
import { safeParseVisualResponse } from "@/lib/telemetry/visual-response";

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
