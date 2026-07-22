import { chat } from "@trigger.dev/sdk/ai";
import { stepCountIs, streamText, tool } from "ai";
import {
  createClickHouseMcpClient,
  createClickStackMcpClient,
} from "@/lib/clickhouse/mcp";
import {
  chartSubmissionSchema,
  heatmapSubmissionSchema,
  metricSubmissionSchema,
  tableSubmissionSchema,
  traceSubmissionSchema,
  unavailableSubmissionSchema,
} from "@/lib/telemetry/visual-response";
import { trinetraModel } from "./model";

const PLACEHOLDER_PATTERN =
  /\b(placeholder|dummy|fake data|sample data|example data|todo)\b/i;

function assertGenuineVisual(input: unknown) {
  const serialized = JSON.stringify(input);
  if (PLACEHOLDER_PATTERN.test(serialized)) {
    throw new Error(
      "Rejected placeholder visual. Submit only values copied from ClickHouse results.",
    );
  }

  const heatmap = (input as { heatmap?: { cells?: unknown[] } } | undefined)
    ?.heatmap;
  if (heatmap?.cells) {
    const parsedCells = heatmap.cells.map((cell) => {
      const value = cell as { row?: unknown; column?: unknown };
      return {
        row: String(value.row ?? ""),
        column: String(value.column ?? ""),
      };
    });
    const labels = parsedCells.flatMap((cell) => [cell.row, cell.column]);
    if (labels.length > 0 && labels.every((label) => label.length <= 1)) {
      throw new Error(
        "Rejected demo-like heatmap labels. Use real service, route, or time-bucket labels from ClickHouse.",
      );
    }
    const rows = new Set(parsedCells.map((cell) => cell.row));
    const columns = new Set(parsedCells.map((cell) => cell.column));
    if (rows.size < 2 || columns.size < 2 || parsedCells.length < 4) {
      throw new Error(
        "Rejected one-dimensional heatmap. Use a chart/table instead, or supply at least two real rows and two real columns.",
      );
    }
  }
}

const submissionTools = {
  submitMetrics: tool({
    description:
      "Submit 2-8 high-signal KPI, status, comparison, or verdict cards. " +
      "Every value must come from ClickHouse evidence gathered this turn.",
    inputSchema: metricSubmissionSchema,
    execute: async (input) => {
      assertGenuineVisual(input);
      return { kind: "metrics" as const, ...input };
    },
  }),
  submitChart: tool({
    description:
      "Submit a trend, distribution, or comparison chart backed by the actual " +
      "ClickHouse rows gathered this turn.",
    inputSchema: chartSubmissionSchema,
    execute: async (input) => {
      assertGenuineVisual(input);
      return { kind: "chart" as const, ...input };
    },
  }),
  submitTable: tool({
    description:
      "Submit the strongest row-level evidence as a searchable table. Include " +
      "only useful columns and actual ClickHouse rows.",
    inputSchema: tableSubmissionSchema,
    execute: async (input) => {
      assertGenuineVisual(input);
      return { kind: "table" as const, ...input };
    },
  }),
  submitHeatmap: tool({
    description:
      "Submit a dense service-by-time, route-by-status, or category-by-bucket " +
      "heatmap. Use actual ClickHouse values, no more than 8 columns, and keep " +
      "the cell grid focused on the strongest pattern.",
    inputSchema: heatmapSubmissionSchema,
    execute: async (input) => {
      assertGenuineVisual(input);
      return { kind: "heatmap" as const, ...input };
    },
  }),
  submitTrace: tool({
    description:
      "Submit an interactive distributed-trace waterfall using actual span " +
      "start times, durations, services, operations, and statuses from ClickHouse.",
    inputSchema: traceSubmissionSchema,
    execute: async (input) => {
      assertGenuineVisual(input);
      return { kind: "trace" as const, ...input };
    },
  }),
  reportUnavailable: tool({
    description:
      "Use only when the available ClickHouse schema or rows cannot honestly " +
      "support the assigned visual lens.",
    inputSchema: unavailableSubmissionSchema,
    execute: async (input) => ({ kind: "unavailable" as const, ...input }),
  }),
};

function hasAcceptedSubmission(steps: unknown) {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    const sources = [
      (step as { content?: unknown }).content,
      (step as { toolResults?: unknown }).toolResults,
    ];
    for (const source of sources) {
      if (!Array.isArray(source)) continue;
      for (const part of source) {
        const output =
          ((part as { output?: { value?: unknown } }).output?.value ??
            (part as { output?: unknown }).output ??
            (part as { result?: unknown }).result) as
            | { kind?: unknown }
            | undefined;
        if (
          output &&
          typeof output.kind === "string" &&
          renderToolNames.includes(
            `submit${output.kind[0].toUpperCase()}${output.kind.slice(1)}` as (typeof renderToolNames)[number],
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

const submissionToolNames = [
  "submitMetrics",
  "submitChart",
  "submitTable",
  "submitHeatmap",
  "submitTrace",
  "reportUnavailable",
] as const;

const renderToolNames = submissionToolNames.filter(
  (name) => name !== "reportUnavailable",
);

function countRenderableEvidence(steps: unknown) {
  if (!Array.isArray(steps)) return 0;
  const dataBearingCalls = new Set<string>();
  const toolNamesByCall = new Map<string, string>();
  const countedResults = new Set<string>();

  for (const step of steps) {
    const sources = [
      (step as { content?: unknown }).content,
      (step as { toolCalls?: unknown }).toolCalls,
    ];
    for (const calls of sources) {
      if (!Array.isArray(calls)) continue;
      for (const call of calls) {
        const candidate = call as {
          toolCallId?: unknown;
          toolName?: unknown;
          input?: { query?: unknown };
          args?: { query?: unknown };
        };
        if (
          typeof candidate.toolCallId !== "string" ||
          typeof candidate.toolName !== "string"
        ) {
          continue;
        }
        toolNamesByCall.set(candidate.toolCallId, candidate.toolName);
        if (candidate.toolName === "run_query") {
          const query = String(
            candidate.input?.query ?? candidate.args?.query ?? "",
          ).trim();
          if (/^(SELECT|WITH)\b/i.test(query)) {
            dataBearingCalls.add(candidate.toolCallId);
          }
          continue;
        }
        if (
          candidate.toolName !== "list_tables" &&
          !submissionToolNames.includes(
            candidate.toolName as (typeof submissionToolNames)[number],
          )
        ) {
          dataBearingCalls.add(candidate.toolCallId);
        }
      }
    }
  }

  for (const step of steps) {
    const sources = [
      (step as { content?: unknown }).content,
      (step as { toolResults?: unknown }).toolResults,
    ];
    for (const results of sources) {
      if (!Array.isArray(results)) continue;
      for (const result of results) {
        const candidate = result as {
          toolCallId?: unknown;
          toolName?: unknown;
          output?: unknown;
          result?: unknown;
        };
        const callId =
          typeof candidate.toolCallId === "string"
            ? candidate.toolCallId
            : undefined;
        const toolName =
          typeof candidate.toolName === "string"
            ? candidate.toolName
            : callId
              ? toolNamesByCall.get(callId)
              : undefined;
        if (!callId || !toolName || !dataBearingCalls.has(callId)) continue;

        const raw =
          (candidate.output as { value?: unknown } | undefined)?.value ??
          candidate.output ??
          candidate.result;
        const hasRows = Array.isArray(raw) && raw.length > 0;
        const hasNestedRows =
          raw &&
          typeof raw === "object" &&
          Array.isArray((raw as { rows?: unknown }).rows) &&
          (raw as { rows: unknown[] }).rows.length > 0;
        if ((hasRows || hasNestedRows) && !countedResults.has(callId)) {
          countedResults.add(callId);
        }
      }
    }
  }
  return countedResults.size;
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
Your assignment contains one explicit objective, depth, and layout slot.

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
   - submitHeatmap for dense two-dimensional intensity or frequency patterns
   - submitTrace for a single distributed trace whose timing exposes the culprit
   Prefer the form that exposes the finding most clearly and interactively.
   Do not default to metric cards or tables merely because they are familiar.
   A trace question should usually become a trace waterfall; a dense service x
   time pattern should usually become a heatmap; temporal change should usually
   become a chart. Use metrics or tables only when those forms are genuinely best.
   Do not choose a renderer before seeing the ClickHouse result shape.
   Put the display title inside metrics/spec/table/heatmap/trace as required by
   that visual object. Do not add a separate top-level title.
5. If the data cannot support an honest visual after exhausting relevant tables
   and time ranges, call reportUnavailable. It TERMINATES the investigation;
   never use it as a placeholder or as a way to request another query. Never
   invent a chart series, KPI, timestamp, service, or causal claim.
6. "Unavailable", "missing data", and similar placeholders are not metrics or
   evidence rows. Report them with reportUnavailable instead of visualizing them.
7. Never visualize query progress, a planned next step, a data-availability check,
   or a zero-row result. If an initial window is empty, inspect the available time
   range and continue the investigation before selecting a renderer.
8. Placeholder, sample, example, or invented renderer values are rejected by the
   tool. If a renderer rejects the payload, correct it using the exact rows already
   returned by ClickHouse or choose a different honest renderer.

Do not write a prose answer. Never issue writes, DDL, or destructive SQL.`,
        messages,
        tools: specialistTools,
        abortSignal: signal,
        stopWhen: [stepCountIs(14), ({ steps }) => hasAcceptedSubmission(steps)],
        prepareStep: async ({ steps }) => {
          const submitted = hasAcceptedSubmission(steps);
          if (!submitted && countRenderableEvidence(steps) >= 3) {
            return {
              activeTools: [...renderToolNames],
              toolChoice: "required" as const,
            };
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
