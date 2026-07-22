import { describe, expect, it } from "vitest";
import {
  buildSelectionFollowUpQuery,
  canonicalVisualDimension,
  createInvestigationSelection,
  investigationFollowUpSchema,
  selectionRelation,
  visualPanelLinkState,
} from "@/lib/telemetry/investigation-selection";
import type { VisualPanel } from "@/lib/telemetry/visual-response";

function chartSelection(
  panelId: string,
  markId: string,
  datum: Record<string, unknown>,
) {
  return createInvestigationSelection({
    responseId: "response-1",
    panelId,
    panelTitle: "Latency by service",
    visualKind: "chart",
    markId,
    label: "Selected chart point",
    datum,
    dimensionFields: ["minute", "service_name"],
    measureFields: ["p99_ms"],
  });
}

describe("point-and-investigate selection", () => {
  it("canonicalizes common telemetry dimension aliases", () => {
    expect(canonicalVisualDimension("resource_service_name")).toBe("service");
    expect(canonicalVisualDimension("Timestamp")).toBe("time");
    expect(canonicalVisualDimension("traceId")).toBe("trace_id");
  });

  it("keeps dimensions separate from numeric measures", () => {
    const selection = chartSelection("latency", "point-2", {
      minute: "10:02",
      service_name: "payments-api",
      p99_ms: 420,
    });

    expect(selection.facets.map((facet) => facet.semantic)).toEqual([
      "time",
      "service",
    ]);
    expect(selection.measures).toEqual([
      { field: "p99_ms", value: 420 },
    ]);
    expect(JSON.parse(JSON.stringify(selection))).toEqual(selection);
  });

  it("links only marks that match every shared dimension", () => {
    const active = chartSelection("latency", "point-2", {
      minute: "10:02",
      service_name: "payments-api",
      p99_ms: 420,
    });
    const related = chartSelection("errors", "bar-1", {
      minute: "10:02",
      service: "payments-api",
      errors: 19,
    });
    const differentTime = chartSelection("errors", "bar-2", {
      minute: "10:03",
      service: "payments-api",
      errors: 19,
    });
    const unrelatedMeasure = chartSelection("errors", "bar-3", {
      queue_depth: 420,
    });

    expect(selectionRelation(active, active)).toBe("selected");
    expect(selectionRelation(active, related)).toBe("related");
    expect(selectionRelation(active, differentTime)).toBe("dimmed");
    expect(selectionRelation(active, unrelatedMeasure)).toBe("default");
  });

  it("detects which response panels can participate in the linked canvas", () => {
    const selection = chartSelection("latency", "point-2", {
      minute: "10:02",
      service_name: "payments-api",
      p99_ms: 420,
    });
    const linked: VisualPanel = {
      id: "errors",
      kind: "table",
      level: "evidence",
      span: "half",
      title: "Error rows",
      eyebrow: "Evidence",
      finding: "Payments errors dominate.",
      table: {
        title: "Errors",
        columns: [{ key: "service", label: "Service" }],
        rows: [{ service: "payments-api" }],
      },
    };
    const unlinked: VisualPanel = {
      id: "totals",
      kind: "metrics",
      level: "overview",
      span: "half",
      title: "Totals",
      eyebrow: "Overview",
      finding: "Volume is normal.",
      metrics: {
        title: "Totals",
        items: [{ label: "Requests", value: "420", tone: "neutral" }],
      },
    };

    expect(visualPanelLinkState(linked, selection)).toBe("linked");
    expect(visualPanelLinkState(unlinked, selection)).toBe("unlinked");
  });

  it("builds a bounded, action-specific backend follow-up", () => {
    const selection = chartSelection("latency", "point-2", {
      minute: "10:02",
      service_name: "payments-api",
      p99_ms: 420,
    });
    const followUp = investigationFollowUpSchema.parse({
      action: "compare",
      originalQuery: "Why was checkout slow Tuesday?",
      selection,
    });
    const query = buildSelectionFollowUpQuery(
      "Compare the selected spike",
      followUp,
    );

    expect(query).toContain("SCOPED VISUAL FOLLOW-UP");
    expect(query).toContain("closest equivalent healthy baseline");
    expect(query).toContain("payments-api");
    expect(query.length).toBeLessThanOrEqual(2000);
  });

  it("keeps the clicked scope when the original query is very long", () => {
    const selection = createInvestigationSelection({
      responseId: "response-1",
      panelId: "service-metrics",
      panelTitle: "Service metrics",
      visualKind: "metrics",
      markId: "metric-0",
      label: "Culprit service: payments-api",
      datum: { "Culprit service": "payments-api" },
      dimensionFields: ["Culprit service"],
    });
    const query = buildSelectionFollowUpQuery("Explain this", {
      action: "explain",
      originalQuery: "x".repeat(2_000),
      selection,
    });

    expect(query).toContain("Action: explain");
    expect(query).toContain('service:Culprit service="payments-api"');
    expect(query).toContain("Stay inside the selected facets");
    expect(query.length).toBeLessThanOrEqual(2000);
  });

  it("sanitizes permissive visual keys and ignores null facets", () => {
    const longField = "service_" + "x".repeat(100);
    const selection = createInvestigationSelection({
      responseId: "response-1",
      panelId: "chart-1",
      panelTitle: "Services",
      visualKind: "chart",
      markId: "row-0",
      label: "Selected service",
      datum: { [longField]: "payments-api", missing: null },
      dimensionFields: [longField, "missing"],
      labels: { [longField]: "" },
    });

    expect(Object.keys(selection.raw)[0]).toHaveLength(64);
    expect(selection.facets).toHaveLength(1);
    expect(selection.facets[0].label).toBeUndefined();
  });

  it("rejects unknown investigation actions", () => {
    expect(
      investigationFollowUpSchema.safeParse({
        action: "delete",
        originalQuery: "Why slow?",
        selection: chartSelection("latency", "point-2", {
          minute: "10:02",
          p99_ms: 420,
        }),
      }).success,
    ).toBe(false);
  });
});
