import { ai, chat } from "@trigger.dev/sdk/ai";
import { type ModelMessage, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import {
  createClickHouseMcpClient,
  createClickStackMcpClient,
} from "@/lib/clickhouse/mcp";
import { readPosteriors } from "@/lib/clickhouse/rewards";
import { classifyContext } from "@/lib/policy/context";
import { applyEvidence, nextArm, type ProbeEvidence } from "@/lib/policy/steering";
import { chooseArms } from "@/lib/policy/thompson";
import { createEpisode, recordDecision } from "@/lib/postgres/episodes";
import {
  chartSpecSchema,
  metricSpecSchema,
  tableSpecSchema,
} from "@/lib/telemetry/chart-spec";
import {
  visualResponseSchema,
  type VisualResponseData,
} from "@/lib/telemetry/visual-response";
import { panelTemplate } from "@/lib/telemetry/panels";
import type { PanelData, Posterior, ProbeArm } from "@/lib/types";
import {
  investigateWithTeam,
  runInvestigationTeam,
} from "./investigation-team";
import { trinetraModel } from "./model";
import { cardinalityScanProbe } from "./probes/cardinality-scan";
import { deployCorrelationProbe } from "./probes/deploy-correlation";
import { errorClusterProbe } from "./probes/error-cluster";
import { latencyShiftProbe } from "./probes/latency-shift";
import { streamChartPanel } from "./probes/shared";
import { traceMiningProbe } from "./probes/trace-mining";
import { visualReportTask } from "./visual-report";

const PROBE_ARMS = [
  "latency_shift",
  "error_cluster",
  "deploy_correlation",
  "trace_mining",
  "cardinality_scan",
] as const;

type ProbeToolName =
  | "latencyShift"
  | "errorCluster"
  | "deployCorrelation"
  | "traceMining"
  | "cardinalityScan";

const ARM_TOOL_NAME: Record<ProbeArm, ProbeToolName> = {
  latency_shift: "latencyShift",
  error_cluster: "errorCluster",
  deploy_correlation: "deployCorrelation",
  trace_mining: "traceMining",
  cardinality_scan: "cardinalityScan",
};

const TOOL_NAME_ARM: Record<string, ProbeArm> = Object.fromEntries(
  Object.entries(ARM_TOOL_NAME).map(([arm, name]) => [name, arm as ProbeArm]),
) as Record<string, ProbeArm>;

/**
 * Best-effort extraction of completed probe results from the AI SDK step
 * history. Defensive across result shapes — any parse failure degrades to "no
 * evidence" (no steering) rather than throwing inside the turn.
 */
function probeEvidenceFromSteps(steps: unknown): ProbeEvidence[] {
  const out: ProbeEvidence[] = [];
  if (!Array.isArray(steps)) return out;

  for (const step of steps) {
    const sources = [
      (step as { content?: unknown }).content,
      (step as { toolResults?: unknown }).toolResults,
    ];
    for (const source of sources) {
      if (!Array.isArray(source)) continue;
      for (const part of source) {
        const record = part as {
          type?: string;
          toolName?: string;
          output?: { value?: unknown } | unknown;
          result?: unknown;
        };
        const toolName = record.toolName;
        if (!toolName) continue;
        const arm = TOOL_NAME_ARM[toolName];
        if (!arm) continue;
        if (record.type && record.type !== "tool-result") continue;
        const payload = (
          (record.output as { value?: unknown } | undefined)?.value ??
          record.output ??
          record.result ??
          {}
        ) as { finding?: unknown; confidence?: unknown };
        out.push({
          arm,
          finding: String(payload.finding ?? ""),
          confidence: Number(payload.confidence ?? 0),
        });
      }
    }
  }
  return out;
}

/** Collect every completed or requested tool name across SDK step shapes. */
function toolNamesFromSteps(steps: unknown): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(steps)) return names;

  for (const step of steps) {
    const sources = [
      (step as { content?: unknown }).content,
      (step as { toolCalls?: unknown }).toolCalls,
      (step as { toolResults?: unknown }).toolResults,
    ];
    for (const source of sources) {
      if (!Array.isArray(source)) continue;
      for (const part of source) {
        const name = (part as { toolName?: unknown; name?: unknown }).toolName ??
          (part as { name?: unknown }).name;
        if (typeof name === "string") names.add(name);
      }
    }
  }
  return names;
}

function latestUserQuery(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    return message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim();
  }
  return "";
}

function isEmailReportRequest(query: string) {
  return (
    /\b(email|e-mail|send|share|deliver)\b/i.test(query) &&
    /\b(report|analysis|results?|visual|incident)\b/i.test(query)
  );
}

function emailRecipient(query: string) {
  return query.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function previousInvestigationQuery(messages: ModelMessage[]) {
  let skippedCurrent = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter(
              (part): part is { type: "text"; text: string } =>
                part.type === "text",
            )
            .map((part) => part.text)
            .join(" ")
            .trim();
    if (!skippedCurrent) {
      skippedCurrent = true;
      continue;
    }
    if (text && !isEmailReportRequest(text)) return text;
  }
  return "";
}

function latestCompletedReport(
  messages: ModelMessage[],
): VisualResponseData | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const content = messages[messageIndex].content;
    if (!Array.isArray(content)) continue;
    for (let partIndex = content.length - 1; partIndex >= 0; partIndex--) {
      const part = content[partIndex] as {
        type?: string;
        output?: unknown;
        result?: unknown;
      };
      if (part.type !== "tool-result") continue;
      const raw = part.output ?? part.result;
      const value =
        (raw as { value?: unknown } | undefined)?.value ?? raw;
      const parsed = visualResponseSchema.safeParse(
        (value as { report?: unknown } | undefined)?.report,
      );
      if (parsed.success && parsed.data.status === "complete") {
        return parsed.data;
      }
    }
  }
  return undefined;
}

function shouldUseInvestigationTeam(query: string) {
  const simpleInventory =
    /\b(list|show|what|which)\b[\s\S]{0,40}\b(tables?|schema)\b/i.test(query);
  if (simpleInventory) return false;
  return /\b(incident|details?|why|root\s*cause|slow|latency|error|trace|logs?|metrics?|compare|analysis|analy[sz]e|service|deploy|spike|regression|outage|culprit|visuals?|visuali[sz](?:e|ation)|charts?|graphs?|plots?|dashboards?)\b/i.test(
    query,
  );
}

const tools = {
  latencyShift: tool({
    description: latencyShiftProbe.description ?? "",
    inputSchema: latencyShiftProbe.schema!,
    execute: ai.toolExecute(latencyShiftProbe),
  }),
  errorCluster: tool({
    description: errorClusterProbe.description ?? "",
    inputSchema: errorClusterProbe.schema!,
    execute: ai.toolExecute(errorClusterProbe),
  }),
  deployCorrelation: tool({
    description: deployCorrelationProbe.description ?? "",
    inputSchema: deployCorrelationProbe.schema!,
    execute: ai.toolExecute(deployCorrelationProbe),
  }),
  traceMining: tool({
    description: traceMiningProbe.description ?? "",
    inputSchema: traceMiningProbe.schema!,
    execute: ai.toolExecute(traceMiningProbe),
  }),
  cardinalityScan: tool({
    description: cardinalityScanProbe.description ?? "",
    inputSchema: cardinalityScanProbe.schema!,
    execute: ai.toolExecute(cardinalityScanProbe),
  }),
  renderChart: tool({
    description:
      "Compose a visualization from telemetry rows you have already queried. " +
      "Choose the mark (line/area/bar/scatter) and x/y encodings that best " +
      "express the finding, and pass the actual rows as `data`. Use this to " +
      "turn raw query results into a panel instead of describing them in prose.",
    inputSchema: chartSpecSchema.extend({
      episodeId: z.string(),
      arm: z.enum(PROBE_ARMS),
      finding: z.string(),
    }),
    execute: async (input, { toolCallId }) => {
      const { episodeId, arm, finding, ...spec } = input;
      const panel: PanelData = {
        ...panelTemplate(arm),
        kind: "chart",
        title: spec.title ?? "",
        finding,
        spec,
      };
      await streamChartPanel(panel, toolCallId ?? `chart-${episodeId}`);
      return { finding, visualRendered: true };
    },
  }),
  renderTable: tool({
    description:
      "Render an inventory or raw query result as a searchable, sortable data " +
      "explorer. Use this for table lists, schemas, traces, logs, and any answer " +
      "where users need to inspect individual rows. Never replace it with a " +
      "markdown table or numbered list.",
    inputSchema: tableSpecSchema.extend({
      episodeId: z.string(),
      arm: z.enum(PROBE_ARMS).optional(),
      finding: z.string().max(180),
    }),
    execute: async (input, { toolCallId }) => {
      const {
        episodeId,
        arm = "cardinality_scan",
        finding,
        ...table
      } = input;
      const panel: PanelData = {
        ...panelTemplate(arm),
        kind: "table",
        title: table.title,
        eyebrow: "Interactive explorer",
        finding,
        table,
      };
      await streamChartPanel(panel, toolCallId ?? `table-${episodeId}`);
      return { finding, visualRendered: true };
    },
  }),
  renderMetrics: tool({
    description:
      "Render a compact visual verdict or KPI comparison. Use this when the " +
      "answer is best expressed as a few headline signals, statuses, deltas, " +
      "or a go/no-go decision rather than paragraphs.",
    inputSchema: metricSpecSchema.extend({
      episodeId: z.string(),
      arm: z.enum(PROBE_ARMS).optional(),
      finding: z.string().max(180),
    }),
    execute: async (input, { toolCallId }) => {
      const { episodeId, arm = "latency_shift", finding, ...metrics } = input;
      const panel: PanelData = {
        ...panelTemplate(arm),
        kind: "metrics",
        title: metrics.title,
        eyebrow: "Signal summary",
        finding,
        metrics,
      };
      await streamChartPanel(panel, toolCallId ?? `metrics-${episodeId}`);
      return { finding, visualRendered: true };
    },
  }),
  investigateWithTeam,
};

export const trinetraAgent = chat.agent({
  id: "trinetra-agent",
  tools,
  run: async ({ messages, chatId, tools: panelTools, signal }) => {
    const query = latestUserQuery(messages);
    const recipient = emailRecipient(query);

    if (recipient && isEmailReportRequest(query)) {
      const existingReport = latestCompletedReport(messages);
      const reportQuery =
        existingReport?.query ?? previousInvestigationQuery(messages);
      const emailTools = {
        sendEmailReport: tool({
          description:
            "Send the user's latest Trinetra visual report through Resend. " +
            "This tool is already bound to the requested recipient and report.",
          inputSchema: z.object({}),
          execute: async () => {
            if (!reportQuery) {
              return {
                emailed: false,
                deliveryMessage:
                  "Create a visual investigation before emailing a report.",
              };
            }

            const result = await visualReportTask.triggerAndWait({
              query: reportQuery,
              email: recipient,
              report: existingReport,
            });

            if (!result.ok) {
              return {
                emailed: false,
                deliveryMessage: "Email delivery task failed.",
              };
            }

            return {
              emailed: result.output.emailed,
              deliveryMessage: result.output.deliveryMessage,
            };
          },
        }),
      };

      return streamText({
        ...chat.toStreamTextOptions({ tools: emailTools }),
        model: trinetraModel(),
        system: `You send Trinetra visual reports. Call sendEmailReport exactly
once, then state its deliveryMessage exactly and concisely. Never say you are
unable to send email. Do not investigate data or call any other tool.`,
        messages,
        tools: emailTools,
        abortSignal: signal,
        stopWhen: stepCountIs(3),
        prepareStep: ({ steps }) =>
          toolNamesFromSteps(steps).has("sendEmailReport")
            ? {}
            : {
                toolChoice: {
                  type: "tool" as const,
                  toolName: "sendEmailReport" as const,
                },
              },
      });
    }

    const context = classifyContext(query);

    // The LLM proposes; the contextual Thompson policy disposes. Sample the
    // next probes from the live ClickHouse posterior for this context, log each
    // decision with its selection propensity, then steer the LLM to run them.
    const posteriors = await readPosteriors(context);
    const choices = chooseArms(posteriors, 3);
    const episodeId = crypto.randomUUID();

    await createEpisode({ id: episodeId, chatId, query, context });
    await Promise.all(
      choices.map((choice, index) => recordDecision(episodeId, index, choice)),
    );

    const policyPlan = choices
      .map(
        (choice, index) =>
          `${index + 1}. ${ARM_TOOL_NAME[choice.arm]} (sampled ${choice.sampledScore.toFixed(
            2,
          )}, propensity ${choice.propensity.toFixed(2)})`,
      )
      .join("\n");

    // Mutable per-turn state for the inner steering loop. As probes complete,
    // their evidence shifts `livePosteriors`; a concentrated cue promotes a
    // follow-up probe and re-plans the remaining arms mid-episode.
    let livePosteriors: Posterior[] = posteriors;
    const executed = new Set<ProbeArm>();
    const promotedArms = new Set<ProbeArm>();
    let decisionStep = choices.length;

    const mcpClient = await createClickHouseMcpClient();
    const clickStackClient = await createClickStackMcpClient();
    let mcpClosed = false;
    const closeMcp = async () => {
      if (mcpClosed) return;
      mcpClosed = true;
      await Promise.all([mcpClient.close(), clickStackClient?.close()]);
    };

    try {
      const clickHouseTools = await mcpClient.tools();
      const clickStackTools = (await clickStackClient?.tools()) ?? {};
      const agentTools = {
        ...panelTools,
        ...clickStackTools,
        ...clickHouseTools,
        investigateWithTeam: tool({
          description: investigateWithTeam.description ?? "",
          inputSchema: z.object({}),
          execute: async (_, { abortSignal }) =>
            runInvestigationTeam(
              {
                query,
                episodeId,
                priorityArms: choices.map((choice) => choice.arm),
              },
              abortSignal,
            ),
        }),
      };

      const toolSurfaceNote =
        Object.keys(clickStackTools).length > 0
          ? `Two telemetry tool surfaces are available. Prefer the ClickStack
investigation primitives (purpose-built search over logs, metrics, and traces)
first; fall back to the raw ClickHouse MCP SQL tools for the long tail.`
          : `Inspect telemetry through the ClickHouse MCP tools.`;

      return streamText({
        ...chat.toStreamTextOptions({ tools: agentTools }),
        model: trinetraModel(),
        system: `You are Trinetra, an incident investigation orchestrator.
The response product is the visual canvas, not a wall of prose.

This turn was classified as context "${context}". The contextual Thompson
policy sampled the following probes, in priority order:
${policyPlan}

Use these sampled probes as priority signals, not predetermined conclusions.
investigateWithTeam is already bound to the current prompt, episode
"${episodeId}", and priority arms: ${choices
          .map((choice) => choice.arm)
          .join(", ")}. Call it without arguments.

${toolSurfaceNote}

Choose the response depth from the prompt:
1. For a simple inventory or schema question, inspect ClickHouse directly and
   render one searchable table. This is intentionally a single-view answer.
2. For incident detail, diagnosis, comparison, or "why" questions, call
   investigateWithTeam exactly once. It runs verdict, trend, and evidence
   specialists in parallel and composes every supported result into one ordered
   multi-level canvas. Do not duplicate its panels with direct render calls.
3. If a team specialist reports unavailable evidence, preserve the partial
   answer. Never invent a missing trend or metric just to fill a slot.
4. For direct single-view questions, choose the renderer from actual tool data:
   - inventories, schemas, logs, traces, or raw rows -> renderTable
   - trends, distributions, or comparisons -> renderChart
   - KPIs, verdicts, deltas, or status summaries -> renderMetrics
5. Never use a markdown table, numbered data dump, or prose list in place of a
   visual. If the user asks to list tables, call list_tables then renderTable.
6. Be honest about exploratory misses. Never claim fine-tuning or RLHF.

Never issue writes, DDL, or destructive SQL. After rendering, keep prose to at
most one short sentence (roughly 12 words). The visual is the answer; words are
only the caption. Greetings and non-data conversation may remain plain text.
Panels stream directly from tools.`,
        messages,
        tools: agentTools,
        abortSignal: signal,
        stopWhen: stepCountIs(12),
        prepareStep: async ({ steps }) => {
          try {
            const calledTools = toolNamesFromSteps(steps);
            if (
              shouldUseInvestigationTeam(query) &&
              !calledTools.has("investigateWithTeam")
            ) {
              return {
                toolChoice: {
                  type: "tool" as const,
                  toolName: "investigateWithTeam" as const,
                },
              };
            }
            const asksForInventory =
              /\b(list|show|what|which)\b[\s\S]{0,40}\b(tables?|schema)\b/i.test(
                query,
              );
            if (
              asksForInventory &&
              calledTools.has("list_tables") &&
              !calledTools.has("renderTable")
            ) {
              return {
                toolChoice: {
                  type: "tool" as const,
                  toolName: "renderTable" as const,
                },
              };
            }

            const evidence = probeEvidenceFromSteps(steps);
            for (const item of evidence) executed.add(item.arm);

            const latest = evidence.at(-1);
            if (!latest) return {};

            const { posteriors: shifted, promoted } = applyEvidence(
              livePosteriors,
              latest,
            );
            livePosteriors = shifted;

            const pick = nextArm(livePosteriors, executed);
            if (!pick) return {};

            await recordDecision(episodeId, decisionStep++, pick);

            // Hard-steer only when a fresh concentrated cue promotes a
            // not-yet-run probe into the top slot — the diagram's inner loop:
            // "the posterior shifts mid-episode -> the next panel changes."
            if (
              promoted &&
              promoted === pick.arm &&
              !executed.has(promoted) &&
              !promotedArms.has(promoted)
            ) {
              promotedArms.add(promoted);
              return {
                toolChoice: {
                  type: "tool" as const,
                  toolName: ARM_TOOL_NAME[promoted],
                },
              };
            }
            return {};
          } catch {
            return {};
          }
        },
        onFinish: closeMcp,
        onError: closeMcp,
      });
    } catch (error) {
      await closeMcp();
      throw error;
    }
  },
});
