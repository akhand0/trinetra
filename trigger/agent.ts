import { openai } from "@ai-sdk/openai";
import { ai, chat } from "@trigger.dev/sdk/ai";
import { type ModelMessage, stepCountIs, streamText, tool } from "ai";
import {
  createClickHouseMcpClient,
  createClickStackMcpClient,
} from "@/lib/clickhouse/mcp";
import { readPosteriors } from "@/lib/clickhouse/rewards";
import { classifyContext } from "@/lib/policy/context";
import { applyEvidence, nextArm, type ProbeEvidence } from "@/lib/policy/steering";
import { chooseArms } from "@/lib/policy/thompson";
import { createEpisode, recordDecision } from "@/lib/postgres/episodes";
import type { Posterior, ProbeArm } from "@/lib/types";
import { cardinalityScanProbe } from "./probes/cardinality-scan";
import { deployCorrelationProbe } from "./probes/deploy-correlation";
import { errorClusterProbe } from "./probes/error-cluster";
import { latencyShiftProbe } from "./probes/latency-shift";
import { traceMiningProbe } from "./probes/trace-mining";

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
};

export const trinetraAgent = chat.agent({
  id: "trinetra-agent",
  tools,
  run: async ({ messages, chatId, tools: panelTools, signal }) => {
    const query = latestUserQuery(messages);
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
      };

      const toolSurfaceNote =
        Object.keys(clickStackTools).length > 0
          ? `Two telemetry tool surfaces are available. Prefer the ClickStack
investigation primitives (purpose-built search over logs, metrics, and traces)
first; fall back to the raw ClickHouse MCP SQL tools for the long tail.`
          : `Inspect telemetry through the ClickHouse MCP tools.`;

      return streamText({
        ...chat.toStreamTextOptions({ tools: agentTools }),
        model: openai(process.env.TRINETRA_MODEL ?? "gpt-5-mini"),
        system: `You are Trinetra, an incident investigation orchestrator.
The response product is the visual canvas, not a wall of prose.

This turn was classified as context "${context}". The contextual Thompson
policy sampled the following probes, in priority order:
${policyPlan}

Run these probe tools first, in this order, before considering any other probe.
Pass episodeId "${episodeId}" to every probe tool you call so its panels and
rewards tie back to this episode.

${toolSurfaceNote}

For every incident question:
1. Inspect telemetry through the MCP tools before reaching a conclusion.
2. Use list_tables to discover available telemetry, then use run_query with
   read-only SELECT statements to investigate logs, metrics, and spans.
3. Run the policy-selected probes above to communicate the MCP evidence.
4. Use the evidence to state one concise likely root cause and confidence.
5. Be honest about exploratory misses. Never claim fine-tuning or RLHF.

Never issue writes, DDL, or destructive SQL. Keep prose to at most three short
sentences. Panels stream directly from tools.`,
        messages,
        tools: agentTools,
        abortSignal: signal,
        stopWhen: stepCountIs(12),
        prepareStep: async ({ steps }) => {
          try {
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
