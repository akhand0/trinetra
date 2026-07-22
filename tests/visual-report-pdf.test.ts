import { describe, expect, it } from "vitest";
import {
  renderVisualReportPdf,
  visualReportPdfFilename,
} from "@/lib/reports/visual-report-pdf";
import type { VisualResponseData } from "@/lib/telemetry/visual-response";

const report: VisualResponseData = {
  id: "investigation-pdf-test",
  query: "Why was checkout slow?",
  title: "Checkout latency regression",
  verdict: "Checkout latency rose immediately after the latest deployment.",
  status: "complete",
  specialists: ["Verdict analyst"],
  panels: [
    {
      id: "overview",
      kind: "metrics",
      level: "overview",
      span: "full",
      title: "Verified verdict",
      eyebrow: "Overview",
      finding: "The deployment is the strongest supported culprit.",
      source: "otel_metrics_histogram",
      metrics: {
        title: "Incident metrics",
        items: [
          {
            label: "P99 delta",
            value: "+184 ms",
            detail: "After deploy",
            tone: "bad",
          },
        ],
      },
    },
    {
      id: "analysis",
      kind: "heatmap",
      level: "analysis",
      span: "full",
      title: "Error concentration",
      eyebrow: "Analysis",
      finding: "Errors concentrate on payments-api after deployment.",
      source: "otel_logs",
      heatmap: {
        title: "Errors by service and minute",
        valueLabel: "errors",
        cells: [
          { row: "payments-api", column: "10:01", value: 2 },
          { row: "payments-api", column: "10:02", value: 19 },
          { row: "checkout", column: "10:01", value: 1 },
          { row: "checkout", column: "10:02", value: 3 },
        ],
      },
    },
    {
      id: "evidence",
      kind: "trace",
      level: "evidence",
      span: "full",
      title: "Slow trace",
      eyebrow: "Evidence",
      finding: "pool.acquire dominates the trace.",
      source: "otel_traces",
      trace: {
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
      },
    },
  ],
};

describe("visual report PDF", () => {
  it("renders the complete report as a PDF attachment", async () => {
    const pdf = await renderVisualReportPdf(report, "run_pdf_test");

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(3_000);
    expect(visualReportPdfFilename(report)).toBe(
      "trinetra-checkout-latency-regression.pdf",
    );
  });
});
