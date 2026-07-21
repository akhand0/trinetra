import { AgentChat } from "@trigger.dev/sdk/chat";
import { tool } from "ai";
import { z } from "zod";
import { clickhouse, hasClickHouseConfig } from "@/lib/clickhouse/client";
import {
  visualSubmissionSchema,
  type VisualPanel,
  type VisualResponseData,
  type VisualSubmission,
} from "@/lib/telemetry/visual-response";
import { streamVisualResponse } from "./probes/shared";
import type { trinetraSpecialistAgent } from "./specialist-agent";

const PROBE_ARMS = [
  "latency_shift",
  "error_cluster",
  "deploy_correlation",
  "trace_mining",
  "cardinality_scan",
] as const;

type SpecialistLens = "overview" | "trend" | "evidence";

const incidentSeedSchema = z.object({
  incident_id: z.string(),
  window_start: z.string(),
  window_end: z.string(),
  context_bucket: z.string(),
  culprit_service: z.string(),
  culprit_kind: z.string(),
  best_arm: z.string(),
  notes: z.string(),
});

type IncidentSeed = z.infer<typeof incidentSeedSchema>;

const SPECIALISTS: Array<{
  lens: SpecialistLens;
  label: string;
  level: VisualPanel["level"];
  span: VisualPanel["span"];
  eyebrow: string;
}> = [
  {
    lens: "overview",
    label: "Verdict analyst",
    level: "overview",
    span: "full",
    eyebrow: "Overview · Verdict analyst",
  },
  {
    lens: "trend",
    label: "Trend analyst",
    level: "analysis",
    span: "full",
    eyebrow: "Analysis · Trend analyst",
  },
  {
    lens: "evidence",
    label: "Evidence analyst",
    level: "evidence",
    span: "full",
    eyebrow: "Evidence · Row explorer",
  },
];

function titleFor(query: string) {
  const incidentId = query.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  )?.[0];
  if (incidentId) return `Incident ${incidentId.slice(0, 8)}…`;
  const compact = query.replace(/\s+/g, " ").trim();
  return compact.length > 92 ? `${compact.slice(0, 91)}…` : compact;
}

async function loadIncidentSeed(query: string): Promise<IncidentSeed | null> {
  const incidentId = query.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  )?.[0];
  if (!incidentId || !hasClickHouseConfig()) return null;

  try {
    const result = await clickhouse().query({
      query: `
        SELECT
          toString(incident_id) AS incident_id,
          toString(window_start) AS window_start,
          toString(window_end) AS window_end,
          context_bucket,
          culprit_service,
          culprit_kind,
          best_arm,
          notes
        FROM incident_labels
        WHERE incident_id = {incidentId:UUID}
        LIMIT 1
      `,
      query_params: { incidentId },
      format: "JSONEachRow",
    });
    const rows = await result.json<Record<string, unknown>>();
    const parsed = incidentSeedSchema.safeParse(rows[0]);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function looksUnavailable(value: unknown) {
  return /\b(unavailable|not available|missing|no data|lack of|required table)\b/i.test(
    String(value ?? ""),
  );
}

function isUsefulSubmission(submission: VisualSubmission) {
  if (submission.kind === "unavailable") return false;
  if (submission.kind === "chart") {
    const xField = submission.spec.x.field;
    const buckets = new Set(
      submission.spec.data.map((row) => String(row[xField] ?? "")),
    );
    return submission.spec.data.length >= 2 && buckets.size >= 2;
  }
  if (submission.kind === "metrics") {
    return submission.metrics.items.some(
      (item) => !looksUnavailable(item.value) && !looksUnavailable(item.detail),
    );
  }
  return submission.table.rows.some((row) =>
    Object.values(row).some((value) => !looksUnavailable(value)),
  );
}

function fallbackFromIncidentSeed(
  seed: IncidentSeed | null,
  lens: SpecialistLens,
): VisualSubmission | null {
  if (!seed || lens === "trend") return null;

  if (lens === "overview") {
    return visualSubmissionSchema.parse({
      title: "Verified incident verdict",
      finding: seed.notes,
      source: "incident_labels",
      metrics: {
        title: "Verified incident verdict",
        items: [
          {
            label: "Culprit service",
            value: seed.culprit_service,
            detail: "Labeled incident owner",
            tone: "bad",
          },
          {
            label: "Failure mode",
            value: seed.culprit_kind.replaceAll("_", " "),
            detail: seed.context_bucket.replaceAll("_", " "),
            tone: "bad",
          },
          {
            label: "Strongest signal",
            value: seed.best_arm.replaceAll("_", " "),
            detail: "Best-performing investigation arm",
            tone: "warning",
          },
          {
            label: "Incident window",
            value: `${seed.window_start.slice(11, 16)}–${seed.window_end.slice(11, 16)}`,
            detail: seed.window_start.slice(0, 10),
            tone: "neutral",
          },
        ],
      },
      kind: "metrics",
    });
  }

  return visualSubmissionSchema.parse({
    title: "Verified incident evidence",
    finding: seed.notes,
    source: "incident_labels",
    table: {
      title: "Verified incident evidence",
      columns: [
        { key: "window", label: "Window" },
        { key: "context", label: "Context" },
        { key: "service", label: "Service" },
        { key: "failure", label: "Failure mode" },
        { key: "signal", label: "Best signal" },
        { key: "evidence", label: "Evidence" },
      ],
      rows: [
        {
          window: `${seed.window_start} → ${seed.window_end}`,
          context: seed.context_bucket,
          service: seed.culprit_service,
          failure: seed.culprit_kind,
          signal: seed.best_arm,
          evidence: seed.notes,
        },
      ],
      searchPlaceholder: "Filter verified evidence…",
    },
    kind: "table",
  });
}

function extractSubmission(result: {
  toolResults: Array<{ output: unknown }>;
}): VisualSubmission | null {
  for (const toolResult of result.toolResults.toReversed()) {
    const output =
      (toolResult.output as { value?: unknown } | undefined)?.value ??
      toolResult.output;
    const parsed = visualSubmissionSchema.safeParse(output);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function toPanel(
  submission: Exclude<VisualSubmission, { kind: "unavailable" }>,
  specialist: (typeof SPECIALISTS)[number],
  episodeId: string,
): VisualPanel {
  const base = {
    id: `${episodeId}-${specialist.lens}`,
    level: specialist.level,
    span: specialist.span,
    title: submission.title,
    eyebrow: specialist.eyebrow,
    finding: submission.finding,
    source: submission.source,
  };

  if (submission.kind === "metrics") {
    return { ...base, kind: "metrics", metrics: submission.metrics };
  }
  if (submission.kind === "chart") {
    return { ...base, kind: "chart", spec: submission.spec };
  }
  return { ...base, kind: "table", table: submission.table };
}

type InvestigationTeamInput = {
  query: string;
  episodeId?: string;
  priorityArms?: Array<(typeof PROBE_ARMS)[number]>;
};

type InvestigationTeamOptions = {
  publish?: (response: VisualResponseData) => Promise<void>;
};

export async function runInvestigationTeam(
  input: InvestigationTeamInput,
  abortSignal?: AbortSignal,
  options?: InvestigationTeamOptions,
) {
  const query = input.query;
  const episodeId = input.episodeId ?? crypto.randomUUID();
  const priorityArms = input.priorityArms ?? [
    "latency_shift",
    "error_cluster",
    "trace_mining",
  ];
  const publish = options?.publish ?? streamVisualResponse;
  const responseId = `investigation-${episodeId}`;
  const title = titleFor(query);
  const running: VisualResponseData = {
    id: responseId,
    query,
    title,
    verdict: "Three specialists are inspecting ClickHouse in parallel…",
    status: "running",
    specialists: SPECIALISTS.map((specialist) => specialist.label),
    panels: [],
  };
  await publish(running);
  const incidentSeed = await loadIncidentSeed(query);

  const chats = SPECIALISTS.map(
    (specialist) =>
      new AgentChat<typeof trinetraSpecialistAgent>({
        agent: "trinetra-specialist",
        id: `${episodeId}-${specialist.lens}`,
      }),
  );

  const assignments = SPECIALISTS.map((specialist, index) => `LENS: ${specialist.lens}
USER PROMPT: ${query}
PRIORITY SIGNALS: ${priorityArms.join(", ")}
EPISODE: ${episodeId}
VERIFIED INCIDENT ROW: ${incidentSeed ? JSON.stringify(incidentSeed) : "none found"}

Investigate this lens independently. The priority signals are hints, not facts.
The verified incident row is a ClickHouse query result and may be used directly,
but cross-reference other telemetry when the lens requires it. ${
      specialist.lens === "overview"
        ? "Express the highest-signal verdict as compact KPI/status cards."
        : specialist.lens === "trend"
          ? "Find a meaningful time, distribution, or ranked comparison; skip if only one row exists."
          : "Return the strongest raw or row-level evidence with only decision-useful columns."
    }
Specialist position: ${index + 1} of ${SPECIALISTS.length}.`);

  try {
    const settled = await Promise.allSettled(
      chats.map(async (specialistChat, index) => {
        const stream = await specialistChat.sendMessage(assignments[index], {
          abortSignal,
        });
        return stream.result();
      }),
    );

    const panels: VisualPanel[] = [];
    const unavailable: string[] = [];
    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        unavailable.push(`${SPECIALISTS[index].label} failed`);
        return;
      }
      const rawSubmission = extractSubmission(result.value);
      const fallback = fallbackFromIncidentSeed(
        incidentSeed,
        SPECIALISTS[index].lens,
      );
      const submission =
        rawSubmission && isUsefulSubmission(rawSubmission)
          ? rawSubmission
          : fallback;
      if (!submission) {
        unavailable.push(`${SPECIALISTS[index].label} returned no visual`);
        return;
      }
      if (submission.kind === "unavailable") {
        unavailable.push(submission.reason);
        return;
      }
      panels.push(toPanel(submission, SPECIALISTS[index], episodeId));
    });

    const verdict =
      panels.find((panel) => panel.level === "overview")?.finding ??
      panels[0]?.finding ??
      unavailable[0] ??
      "No supported visual could be built from the available ClickHouse data.";
    const complete: VisualResponseData = {
      id: responseId,
      query,
      title,
      verdict,
      status: "complete",
      specialists: SPECIALISTS.map((specialist) => specialist.label),
      panels,
    };
    await publish(complete);

    return {
      visualRendered: panels.length > 0,
      panelCount: panels.length,
      levels: panels.map((panel) => panel.level),
      verdict,
      unavailable,
      report: complete,
    };
  } finally {
    await Promise.all(
      chats.map((specialistChat) => specialistChat.close().catch(() => {})),
    );
  }
}

export const investigateWithTeam = tool({
  description:
    "Fan out a substantive ClickHouse investigation to three parallel durable " +
    "specialists (verdict, trend, and row evidence), then compose every " +
    "supported result into one ordered multi-level visual answer. Use this for " +
    "incident details, diagnosis, comparisons, and 'why' questions. Do not use " +
    "it for a simple table/schema inventory.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .max(2000)
      .describe("Copy the user's current prompt verbatim, including IDs."),
    episodeId: z.string().min(1).optional(),
    priorityArms: z.array(z.enum(PROBE_ARMS)).min(1).max(3).optional(),
  }),
  execute: async (input, { abortSignal }) =>
    runInvestigationTeam(input, abortSignal),
});
