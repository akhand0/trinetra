import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisualSubmission } from "@/lib/telemetry/visual-response";

const agentMocks = vi.hoisted(() => ({
  submissions: [] as unknown[],
  close: vi.fn(),
}));

vi.mock("@trigger.dev/sdk/chat", () => ({
  AgentChat: class {
    async sendMessage() {
      const submission = agentMocks.submissions.shift();
      return {
        result: async () => ({
          toolResults: [{ output: { value: submission } }],
        }),
      };
    }

    async close() {
      agentMocks.close();
    }
  },
}));

vi.mock("@/lib/clickhouse/client", () => ({
  clickhouse: vi.fn(),
  hasClickHouseConfig: () => false,
}));

import { runInvestigationTeam } from "@/trigger/investigation-team";

const metrics: VisualSubmission = {
  kind: "metrics",
  finding: "payments-api is the culprit.",
  metrics: {
    title: "Incident verdict",
    items: [{ label: "Service", value: "payments-api" }],
  },
};

const line: VisualSubmission = {
  kind: "chart",
  finding: "p99 rose after the deployment.",
  spec: {
    mark: "line",
    title: "p99 over time",
    x: { field: "minute" },
    y: { field: "p99_ms" },
    data: [
      { minute: "10:01", p99_ms: 180 },
      { minute: "10:02", p99_ms: 420 },
      { minute: "10:03", p99_ms: 690 },
    ],
  },
};

const table: VisualSubmission = {
  kind: "table",
  finding: "The slowest requests came from payments-api.",
  table: {
    title: "Slow request evidence",
    columns: [
      { key: "service", label: "Service" },
      { key: "duration_ms", label: "Duration (ms)" },
    ],
    rows: [
      { service: "payments-api", duration_ms: 910 },
      { service: "payments-api", duration_ms: 840 },
    ],
  },
};

describe("investigation team composition", () => {
  beforeEach(() => {
    agentMocks.submissions = [];
    agentMocks.close.mockClear();
  });

  it("publishes verdict, chart, and table deliverables without collapsing them", async () => {
    agentMocks.submissions = [metrics, line, table];
    const published: unknown[] = [];

    const result = await runInvestigationTeam(
      {
        query: "Why was payments-api slow?",
        episodeId: "episode-visual-mix",
        plan: {
          specialists: [
            {
              id: "verdict",
              label: "Lead investigator",
              objective: "Identify the concise data-backed incident verdict.",
              level: "overview",
              span: "full",
              deliverable: "verdict",
            },
            {
              id: "timeline",
              label: "Latency investigator",
              objective: "Measure how latency changed across the incident window.",
              level: "analysis",
              span: "half",
              deliverable: "series",
            },
            {
              id: "evidence",
              label: "Evidence investigator",
              objective: "Expose the request rows that support the diagnosis.",
              level: "evidence",
              span: "half",
              deliverable: "rows",
            },
          ],
        },
      },
      undefined,
      {
        publish: async (response) => {
          published.push(response);
        },
      },
    );

    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({ status: "running", panels: [] });
    expect(published[1]).toMatchObject({ status: "complete" });
    expect(result.visualRendered).toBe(true);
    expect(result.panelCount).toBe(3);
    expect(result.report.panels.map((panel) => panel.kind)).toEqual([
      "metrics",
      "chart",
      "table",
    ]);
    expect(
      result.report.panels[1].kind === "chart"
        ? result.report.panels[1].spec.mark
        : null,
    ).toBe("line");
    expect(agentMocks.close).toHaveBeenCalledTimes(3);
  });

  it("does not accept metric cards for a series deliverable", async () => {
    agentMocks.submissions = [metrics];

    const result = await runInvestigationTeam(
      {
        query: "Show latency over time",
        episodeId: "episode-shape-guard",
        plan: {
          specialists: [
            {
              id: "timeline",
              label: "Timeline investigator",
              objective: "Measure latency in ordered buckets across the window.",
              level: "overview",
              span: "full",
              deliverable: "series",
            },
          ],
        },
      },
      undefined,
      { publish: async () => {} },
    );

    expect(result.visualRendered).toBe(false);
    expect(result.panelCount).toBe(0);
    expect(result.unavailable).toContain(
      "Timeline investigator returned no visual",
    );
  });

  it("composes more than three non-overlapping specialist visuals", async () => {
    agentMocks.submissions = [metrics, line, line, table, table];

    const result = await runInvestigationTeam(
      {
        query: "Investigate traffic, latency, errors, logs, and traces",
        episodeId: "episode-expanded-team",
        plan: {
          specialists: [
            {
              id: "verdict",
              label: "Lead investigator",
              objective: "Determine the strongest concise incident verdict.",
              level: "overview",
              span: "full",
              deliverable: "verdict",
            },
            {
              id: "traffic",
              label: "Traffic investigator",
              objective: "Measure request volume across the available time range.",
              level: "analysis",
              span: "half",
              deliverable: "series",
            },
            {
              id: "latency",
              label: "Latency investigator",
              objective: "Measure latency independently across the available range.",
              level: "analysis",
              span: "half",
              deliverable: "series",
            },
            {
              id: "logs",
              label: "Log evidence investigator",
              objective: "Find the strongest row-level log evidence for the incident.",
              level: "evidence",
              span: "half",
              deliverable: "rows",
            },
            {
              id: "traces",
              label: "Trace evidence investigator",
              objective: "Find distinct row-level trace evidence for the incident.",
              level: "evidence",
              span: "half",
              deliverable: "rows",
            },
          ],
        },
      },
      undefined,
      { publish: async () => {} },
    );

    expect(result.panelCount).toBe(5);
    expect(result.report.panels.map((panel) => panel.kind)).toEqual([
      "metrics",
      "chart",
      "chart",
      "table",
      "table",
    ]);
    expect(agentMocks.close).toHaveBeenCalledTimes(5);
  });

  it("uses one minimal investigator when a generated plan is unavailable", async () => {
    agentMocks.submissions = [metrics];

    const result = await runInvestigationTeam(
      {
        query: "Investigate an unfamiliar telemetry question",
        episodeId: "episode-minimal-fallback",
      },
      undefined,
      { publish: async () => {} },
    );

    expect(result.panelCount).toBe(1);
    expect(result.report.specialists).toEqual(["Lead investigator"]);
    expect(agentMocks.close).toHaveBeenCalledTimes(1);
  });
});
