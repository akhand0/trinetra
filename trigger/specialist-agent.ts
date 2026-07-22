import { chat } from "@trigger.dev/sdk/ai";
import { stepCountIs, streamText, tool } from "ai";
import {
  createClickHouseMcpClient,
  createClickStackMcpClient,
} from "@/lib/clickhouse/mcp";
import {
  chartSubmissionSchema,
  metricSubmissionSchema,
  tableSubmissionSchema,
  unavailableSubmissionSchema,
} from "@/lib/telemetry/visual-response";
import { trinetraModel } from "./model";

const submissionTools = {
  submitMetrics: tool({
    description:
      "Submit 2-8 high-signal KPI, status, comparison, or verdict cards. " +
      "Every value must come from ClickHouse evidence gathered this turn.",
    inputSchema: metricSubmissionSchema,
    execute: async (input) => ({ kind: "metrics" as const, ...input }),
  }),
  submitChart: tool({
    description:
      "Submit a trend, distribution, or comparison chart backed by the actual " +
      "ClickHouse rows gathered this turn.",
    inputSchema: chartSubmissionSchema,
    execute: async (input) => ({ kind: "chart" as const, ...input }),
  }),
  submitTable: tool({
    description:
      "Submit the strongest row-level evidence as a searchable table. Include " +
      "only useful columns and actual ClickHouse rows.",
    inputSchema: tableSubmissionSchema,
    execute: async (input) => ({ kind: "table" as const, ...input }),
  }),
  reportUnavailable: tool({
    description:
      "Use only when the available ClickHouse schema or rows cannot honestly " +
      "support the assigned visual lens.",
    inputSchema: unavailableSubmissionSchema,
    execute: async (input) => ({ kind: "unavailable" as const, ...input }),
  }),
};

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
        const name = (part as { toolName?: unknown }).toolName;
        if (typeof name === "string") names.add(name);
      }
    }
  }
  return names;
}

export const trinetraSpecialistAgent = chat.agent({
  id: "trinetra-specialist",
  tools: submissionTools,
  run: async ({ messages, tools, signal }) => {
    const mcpClient = await createClickHouseMcpClient();
    const clickStackClient = await createClickStackMcpClient();
    let closed = false;
    const closeMcp = async () => {
      if (closed) return;
      closed = true;
      await Promise.all([mcpClient.close(), clickStackClient?.close()]);
    };

    try {
      const clickHouseTools = await mcpClient.tools();
      const clickStackTools = (await clickStackClient?.tools()) ?? {};
      const specialistTools = {
        ...tools,
        ...clickStackTools,
        ...clickHouseTools,
      };

      return streamText({
        ...chat.toStreamTextOptions({ tools: specialistTools }),
        model: trinetraModel(),
        system: `You are one specialist in a parallel ClickHouse investigation.
Your assignment contains one explicit LENS: overview, trend, or evidence.

Work independently and only from data that is actually available:
1. Discover relevant tables and schemas before querying.
2. Run read-only SELECT queries that directly answer the user's prompt.
3. Cross-reference the requested entity, ID, service, and time window when present.
4. After inspecting the actual rows, choose exactly one visual form with the
   highest insight-to-space ratio for this prompt. The lens controls analytical
   depth, not visual type; every lens may choose any renderer:
   - submitMetrics for a small set of decisive values, deltas, or statuses
   - submitChart for ordered time buckets, distributions, or comparisons
   - submitTable for logs, traces, events, or evidence that benefits from
     searching, sorting, and row-level exploration
   Prefer the form that exposes the finding most clearly and interactively.
   Do not choose a renderer before seeing the ClickHouse result shape.
5. If the data cannot support an honest visual, call reportUnavailable. Never invent a
   chart series, KPI, timestamp, service, or causal claim.
6. "Unavailable", "missing data", and similar placeholders are not metrics or
   evidence rows. Report them with reportUnavailable instead of visualizing them.

Do not write a prose answer. Never issue writes, DDL, or destructive SQL.`,
        messages,
        tools: specialistTools,
        abortSignal: signal,
        stopWhen: stepCountIs(10),
        prepareStep: async ({ steps }) => {
          const called = toolNamesFromSteps(steps);
          const submitted = [
            "submitMetrics",
            "submitChart",
            "submitTable",
            "reportUnavailable",
          ].some((name) => called.has(name));
          if (!submitted && called.has("run_query")) {
            return { toolChoice: "required" as const };
          }
          return {};
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
