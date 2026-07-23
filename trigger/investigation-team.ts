import { AgentChat } from "@trigger.dev/sdk/chat";
import { tool } from "ai";
import { z } from "zod";
import { clickhouse, hasClickHouseConfig } from "@/lib/clickhouse/client";
import {
  VISUAL_DELIVERABLES,
  visualKindSupportsDeliverable,
} from "@/lib/telemetry/visual-deliverables";
import {
  MAX_INVESTIGATION_VISUALS,
  hypothesisEvaluationSchema,
  unavailableSubmissionSchema,
  visualSubmissionSchema,
  type HypothesisEvidence,
  type VisualPanel,
  type VisualResponseData,
  type VisualSubmission,
} from "@/lib/telemetry/visual-response";
import {
  HYPOTHESIS_DEFINITIONS,
  addHypothesisEvidence,
  createHypothesisRace,
  markHypothesisUnavailable,
  reconcileHypothesisRace,
  resolveHypothesisRace,
  setHypothesisProgress,
} from "@/lib/telemetry/hypothesis-race";
import { streamVisualResponse } from "./probes/shared";
import type { trinetraSpecialistAgent } from "./specialist-agent";

const PROBE_ARMS = [
  "latency_shift",
  "error_cluster",
  "deploy_correlation",
  "trace_mining",
  "cardinality_scan",
] as const;

const visualAssignmentSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(2).max(48),
  objective: z.string().min(12).max(420),
  level: z.enum(["overview", "analysis", "evidence"]),
  span: z.enum(["full", "half"]),
  deliverable: z
    .enum(VISUAL_DELIVERABLES)
    .describe(
      "The data shape this specialist must investigate: verdict for a concise decision, series for ordered/comparative data, or rows for inspectable evidence.",
    ),
});

export const investigationPlanSchema = z.object({
  specialists: z
    .array(visualAssignmentSchema)
    .min(1)
    .max(MAX_INVESTIGATION_VISUALS),
});

type VisualAssignment = z.infer<typeof visualAssignmentSchema>;

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

function fallbackAssignments(query: string): VisualAssignment[] {
  if (/\b(trace|span|waterfall|critical path)\b/i.test(query)) {
    return [
      {
        id: "critical-path",
        label: "Critical-path investigator",
        objective:
          "Find the single trace and span sequence that most directly answers the prompt.",
        level: "overview",
        span: "full",
        deliverable: "rows",
      },
      {
        id: "trace-context",
        label: "Trace context analyst",
        objective:
          "Compare the selected trace with nearby telemetry only when it adds decision-useful context.",
        level: "analysis",
        span: "half",
        deliverable: "series",
      },
    ];
  }
  if (/\b(cluster|heatmap|where and when|across services)\b/i.test(query)) {
    return [
      {
        id: "pattern",
        label: "Pattern investigator",
        objective:
          "Locate the strongest two-dimensional concentration in the requested services and time window.",
        level: "overview",
        span: "full",
        deliverable: "series",
      },
      {
        id: "outlier",
        label: "Outlier verifier",
        objective:
          "Verify the dominant cluster and expose the smallest useful set of supporting evidence.",
        level: "evidence",
        span: "half",
        deliverable: "rows",
      },
    ];
  }
  return [
    {
      id: "lead",
      label: "Lead investigator",
      objective:
        "Find the highest-signal data-backed answer and choose the visual that communicates it best.",
      level: "overview",
      span: "full",
      deliverable: "verdict",
    },
  ];
}

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
  if (!hasClickHouseConfig()) return null;

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
        ${incidentId ? "WHERE incident_id = {incidentId:UUID}" : ""}
        ORDER BY window_start DESC
        LIMIT ${incidentId ? 1 : 20}
      `,
      query_params: incidentId ? { incidentId } : undefined,
      format: "JSONEachRow",
    });
    const rows = await result.json<Record<string, unknown>>();
    const seeds = rows.flatMap((row) => {
      const parsed = incidentSeedSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
    if (incidentId || seeds.length < 2) return seeds[0] ?? null;

    const normalizedQuery = query.toLowerCase().replaceAll(/[_-]+/g, " ");
    return (
      seeds.find((seed) =>
        [
          seed.culprit_service,
          seed.culprit_kind,
          seed.context_bucket,
          seed.best_arm,
        ].some((value) =>
          normalizedQuery.includes(value.toLowerCase().replaceAll(/[_-]+/g, " ")),
        ),
      ) ?? seeds[0]
    );
  } catch {
    return null;
  }
}

function looksUnavailable(value: unknown) {
  return /\b(unavailable|not available|missing|no data|lack of|required table|0 rows?|zero rows?|next step|data range check)\b/i.test(
    String(value ?? ""),
  );
}

function isUsefulSubmission(submission: VisualSubmission) {
  if (submission.kind === "unavailable") return false;
  if (
    /\b(placeholder|dummy|fake data|sample data|example data|todo)\b/i.test(
      JSON.stringify(submission),
    )
  ) {
    return false;
  }
  if (submission.kind === "chart") {
    const xField = submission.spec.x.field;
    const yField = submission.spec.y.field;
    const usableRows = submission.spec.data.filter((row) => {
      const x = row[xField];
      const y = Number(row[yField]);
      return x !== undefined && String(x).length > 0 && Number.isFinite(y);
    });
    const buckets = new Set(
      usableRows.map((row) => String(row[xField])),
    );
    return usableRows.length >= 2 && buckets.size >= 2;
  }
  if (submission.kind === "metrics") {
    return submission.metrics.items.some(
      (item) => !looksUnavailable(item.value) && !looksUnavailable(item.detail),
    );
  }
  if (submission.kind === "heatmap") {
    const rows = new Set(submission.heatmap.cells.map((cell) => cell.row));
    const columns = new Set(
      submission.heatmap.cells.map((cell) => cell.column),
    );
    return (
      submission.heatmap.cells.length >= 4 &&
      rows.size >= 2 &&
      columns.size >= 2
    );
  }
  if (submission.kind === "trace") {
    return submission.trace.spans.some((span) => span.durationMs > 0);
  }
  return submission.table.rows.some((row) =>
    submission.table.columns.some((column) => {
      const value = row[column.key];
      return value !== undefined && !looksUnavailable(value);
    }),
  );
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

type HypothesisSubmission =
  | ({ kind: "hypothesis" } & z.infer<typeof hypothesisEvaluationSchema>)
  | ({ kind: "unavailable" } & z.infer<typeof unavailableSubmissionSchema>);

function extractHypothesisSubmission(result: {
  toolResults: Array<{ output: unknown }>;
}): HypothesisSubmission | null {
  for (const toolResult of result.toolResults.toReversed()) {
    const output =
      (toolResult.output as { value?: unknown } | undefined)?.value ??
      toolResult.output;
    const kind = (output as { kind?: unknown } | undefined)?.kind;
    if (kind === "hypothesis") {
      const parsed = hypothesisEvaluationSchema.safeParse(output);
      if (parsed.success) return { kind: "hypothesis", ...parsed.data };
    }
    if (kind === "unavailable") {
      const parsed = unavailableSubmissionSchema.safeParse(output);
      if (parsed.success) return { kind: "unavailable", ...parsed.data };
    }
  }
  return null;
}

function toPanel(
  submission: Exclude<VisualSubmission, { kind: "unavailable" }>,
  specialist: VisualAssignment,
  episodeId: string,
): VisualPanel {
  const visualTitle =
    submission.kind === "metrics"
      ? submission.metrics.title
      : submission.kind === "chart"
        ? submission.spec.title ?? specialist.label
        : submission.kind === "table"
          ? submission.table.title
          : submission.kind === "heatmap"
            ? submission.heatmap.title
            : submission.trace.title;
  const base = {
    id: `${episodeId}-${specialist.id}`,
    level: specialist.level,
    span: specialist.span,
    title: visualTitle,
    eyebrow: `${specialist.level} · ${specialist.label}`,
    finding: submission.finding,
    source: submission.source,
  };

  if (submission.kind === "metrics") {
    return { ...base, kind: "metrics", metrics: submission.metrics };
  }
  if (submission.kind === "chart") {
    return { ...base, kind: "chart", spec: submission.spec };
  }
  if (submission.kind === "table") {
    return { ...base, kind: "table", table: submission.table };
  }
  if (submission.kind === "heatmap") {
    return { ...base, kind: "heatmap", heatmap: submission.heatmap };
  }
  return { ...base, kind: "trace", trace: submission.trace };
}

type InvestigationTeamInput = {
  query: string;
  displayQuery?: string;
  episodeId?: string;
  priorityArms?: Array<(typeof PROBE_ARMS)[number]>;
  plan?: z.infer<typeof investigationPlanSchema>;
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
  const displayQuery = input.displayQuery ?? query;
  const episodeId = input.episodeId ?? crypto.randomUUID();
  const priorityArms = input.priorityArms ?? [
    "latency_shift",
    "error_cluster",
    "trace_mining",
  ];
  const publish = options?.publish ?? streamVisualResponse;
  const responseId = `investigation-${episodeId}`;
  const title = titleFor(displayQuery);
  const parsedPlan = investigationPlanSchema.safeParse(input.plan);
  const specialists = parsedPlan.success
    ? parsedPlan.data.specialists
    : fallbackAssignments(query);
  let hypothesisRace = createHypothesisRace();
  const running: VisualResponseData = {
    id: responseId,
    query: displayQuery,
    title,
    verdict: `Four competing causes are entering the evidence race while ${specialists.length} visual investigator${specialists.length === 1 ? " inspects" : "s inspect"} ClickHouse…`,
    status: "running",
    specialists: specialists.map((specialist) => specialist.label),
    hypothesisRace,
    panels: [],
  };
  await publish(running);
  const incidentSeed = await loadIncidentSeed(query);

  const chats = specialists.map(
    (specialist) =>
      new AgentChat<typeof trinetraSpecialistAgent>({
        agent: "trinetra-specialist",
        id: `${episodeId}-${specialist.id}`,
      }),
  );
  const hypothesisChats = HYPOTHESIS_DEFINITIONS.map(
    (hypothesis) =>
      new AgentChat<typeof trinetraSpecialistAgent>({
        agent: "trinetra-specialist",
        id: `${episodeId}-hypothesis-${hypothesis.id}`,
      }),
  );

  const assignments = specialists.map((specialist, index) => `SPECIALIST: ${specialist.label}
OBJECTIVE: ${specialist.objective}
DEPTH: ${specialist.level}
LAYOUT: ${specialist.span}
DELIVERABLE: ${specialist.deliverable}
USER PROMPT: ${query}
PRIORITY SIGNALS: ${priorityArms.join(", ")}
EPISODE: ${episodeId}
VERIFIED INCIDENT ROW: ${incidentSeed ? JSON.stringify(incidentSeed) : "none found"}

Investigate this objective independently. The priority signals are hints, not facts.
The verified incident row is the best matching recent ClickHouse incident and
may anchor the investigation. It is sufficient by itself only for a verdict;
series and rows deliverables must query supporting telemetry. Choose the exact
visual within the assigned deliverable from the returned data shape.
Specialist position: ${index + 1} of ${specialists.length}.`);

  const hypothesisAssignments = HYPOTHESIS_DEFINITIONS.map(
    (hypothesis) => `HYPOTHESIS: ${hypothesis.id}
LABEL: ${hypothesis.label}
OBJECTIVE: ${hypothesis.objective}
USER PROMPT: ${query}
PRIORITY SIGNALS: ${priorityArms.join(", ")}
EPISODE: ${episodeId}
INCIDENT CONTEXT: ${
      incidentSeed
        ? JSON.stringify({
            incident_id: incidentSeed.incident_id,
            window_start: incidentSeed.window_start,
            window_end: incidentSeed.window_end,
          })
        : "none found"
    }

Test only this causal hypothesis against actual ClickHouse telemetry. Compare the
incident window with a useful baseline when the data permits. The incident
context identifies the window but does not reveal or prove its cause. Return one structured
hypothesis verdict after querying, or report the exact unavailable evidence.`,
  );

  const panelSlots: Array<VisualPanel | undefined> = Array(
    specialists.length,
  ).fill(undefined);
  const unavailableSlots: Array<string | undefined> = Array(
    specialists.length,
  ).fill(undefined);
  let publishQueue = Promise.resolve();

  const runningVerdict = () => {
    const leader = hypothesisRace.hypotheses.find(
      (hypothesis) => hypothesis.state === "leading",
    );
    const progress = `${hypothesisRace.completed}/${hypothesisRace.total} competing causes tested`;
    return leader
      ? `${progress} · ${leader.label} currently leads on evidence.`
      : `${progress} · Evidence is arriving live from ClickHouse.`;
  };

  const publishRunningSnapshot = () => {
    const snapshot: VisualResponseData = {
      id: responseId,
      query: displayQuery,
      title,
      verdict: runningVerdict(),
      status: "running",
      specialists: specialists.map((specialist) => specialist.label),
      hypothesisRace,
      panels: panelSlots.flatMap((panel) => (panel ? [panel] : [])),
    };
    publishQueue = publishQueue.then(() => publish(snapshot));
    return publishQueue;
  };

  try {
    const visualJobs = chats.map(async (specialistChat, index) => {
      try {
        const stream = await specialistChat.sendMessage(assignments[index], {
          abortSignal,
        });
        const result = await stream.result();
        const rawSubmission = extractSubmission(result);
        if (rawSubmission?.kind === "unavailable") {
          unavailableSlots[index] = rawSubmission.reason;
        } else {
          const submission =
            rawSubmission &&
            visualKindSupportsDeliverable(
              specialists[index].deliverable,
              rawSubmission.kind,
            ) &&
            isUsefulSubmission(rawSubmission)
              ? rawSubmission
              : null;
          if (submission) {
            panelSlots[index] = toPanel(
              submission,
              specialists[index],
              episodeId,
            );
          } else {
            unavailableSlots[index] =
              `${specialists[index].label} returned no visual`;
          }
        }
      } catch {
        unavailableSlots[index] = `${specialists[index].label} failed`;
      }
      await publishRunningSnapshot();
    });

    const hypothesisJobs = hypothesisChats.map(
      async (hypothesisChat, index) => {
        const hypothesis = HYPOTHESIS_DEFINITIONS[index];
        try {
          const stream = await hypothesisChat.sendMessage(
            hypothesisAssignments[index],
            { abortSignal },
          );
          const result = await stream.result();
          const submission = extractHypothesisSubmission(result);
          if (
            submission?.kind === "hypothesis" &&
            submission.id === hypothesis.id
          ) {
            const evidence: HypothesisEvidence = {
              id: `${episodeId}-hypothesis-evidence-${hypothesis.id}`,
              hypothesisId: hypothesis.id,
              direction: submission.direction,
              summary: submission.rationale,
              confidence: submission.confidence,
              source: submission.source,
              observed: submission.observed,
              baseline: submission.baseline,
              window: submission.window,
            };
            hypothesisRace = addHypothesisEvidence(
              hypothesisRace,
              evidence,
            );
          } else {
            const note =
              submission?.kind === "unavailable"
                ? submission.reason
                : `${hypothesis.label} investigator returned no supported verdict.`;
            hypothesisRace = markHypothesisUnavailable(
              hypothesisRace,
              hypothesis.id,
              note,
            );
          }
        } catch {
          hypothesisRace = markHypothesisUnavailable(
            hypothesisRace,
            hypothesis.id,
            `${hypothesis.label} investigator failed before reaching a verdict.`,
          );
        }
        hypothesisRace = setHypothesisProgress(
          hypothesisRace,
          hypothesisRace.completed + 1,
        );
        await publishRunningSnapshot();
      },
    );

    await Promise.all([...visualJobs, ...hypothesisJobs]);
    await publishQueue;

    const panels = panelSlots.flatMap((panel) => (panel ? [panel] : []));
    const unavailable = unavailableSlots.flatMap((message) =>
      message ? [message] : [],
    );
    const verdict =
      panels.find((panel) => panel.level === "overview")?.finding ??
      panels[0]?.finding ??
      unavailable[0] ??
      "No supported visual could be built from the available ClickHouse data.";
    hypothesisRace = reconcileHypothesisRace(
      resolveHypothesisRace(hypothesisRace),
      verdict,
    );
    const raceWinner =
      hypothesisRace.status === "resolved"
        ? hypothesisRace.hypotheses.find(
            (hypothesis) => hypothesis.id === hypothesisRace.winnerId,
          )
        : undefined;
    const reconciledVerdict = raceWinner
      ? `${raceWinner.label} is the best-supported cause. ${verdict}`
      : verdict;
    const complete: VisualResponseData = {
      id: responseId,
      query: displayQuery,
      title,
      verdict: reconciledVerdict,
      status: "complete",
      specialists: specialists.map((specialist) => specialist.label),
      hypothesisRace,
      panels,
    };
    await publish(complete);

    return {
      visualRendered: panels.length > 0,
      panelCount: panels.length,
      levels: panels.map((panel) => panel.level),
      verdict: reconciledVerdict,
      unavailable,
      report: complete,
    };
  } finally {
    await Promise.all(
      [...chats, ...hypothesisChats].map((specialistChat) =>
        specialistChat.close().catch(() => {}),
      ),
    );
  }
}

export const investigateWithTeam = tool({
  description:
    "Fan out a substantive ClickHouse investigation to a prompt-specific team " +
    `of one to ${MAX_INVESTIGATION_VISUALS} durable specialists chosen by the orchestrator. ` +
    "The orchestrator decides the count from the independent questions in the prompt; " +
    "never target a fixed panel count or add duplicate filler. Give each specialist a " +
    "verdict, series, or rows deliverable; it selects the best compatible interactive visual " +
    "after querying the data, then compose every " +
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
    plan: investigationPlanSchema.optional(),
  }),
  execute: async (input, { abortSignal }) =>
    runInvestigationTeam(input, abortSignal),
});
