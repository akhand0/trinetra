import { ai, chat } from "@trigger.dev/sdk/ai";
import { clickhouse, hasClickHouseConfig } from "@/lib/clickhouse/client";
import type { PanelData, ProbeArm } from "@/lib/types";

const probeQueries: Record<ProbeArm, string> = {
  latency_shift: `
    SELECT
      toStartOfMinute(ts) AS minute,
      quantile(0.99)(value) AS p99_ms
    FROM metrics
    WHERE name = 'http.server.duration'
      AND ts >= now() - INTERVAL 3 HOUR
    GROUP BY minute
    ORDER BY minute
  `,
  error_cluster: `
    SELECT
      service,
      countIf(level = 'error') AS errors,
      uniqExact(trace_id) AS affected_traces
    FROM logs
    WHERE ts >= now() - INTERVAL 3 HOUR
    GROUP BY service
    ORDER BY errors DESC
    LIMIT 8
  `,
  deploy_correlation: `
    SELECT
      service,
      any(message) AS deploy_event,
      max(ts) AS deployed_at
    FROM logs
    WHERE ts >= now() - INTERVAL 6 HOUR
      AND attrs['event.kind'] = 'deployment'
    GROUP BY service
    ORDER BY deployed_at DESC
  `,
  trace_mining: `
    SELECT
      trace_id,
      sum(duration_ms) AS total_ms,
      argMax(service, duration_ms) AS slowest_service,
      max(duration_ms) AS slowest_span_ms
    FROM spans
    WHERE ts >= now() - INTERVAL 3 HOUR
    GROUP BY trace_id
    ORDER BY total_ms DESC
    LIMIT 20
  `,
  cardinality_scan: `
    SELECT
      service,
      uniqExact(mapKeys(tags)) AS distinct_tag_keys,
      count() AS points
    FROM metrics
    WHERE ts >= now() - INTERVAL 24 HOUR
    GROUP BY service
    ORDER BY distinct_tag_keys DESC
  `,
};

export async function runProbeQuery(arm: ProbeArm): Promise<number> {
  if (!hasClickHouseConfig()) return 0;
  const result = await clickhouse().query({
    query: probeQueries[arm],
    format: "JSONEachRow",
  });
  const rows = await result.json<Record<string, unknown>>();
  return rows.length;
}

export async function streamPanel(
  panel: PanelData,
  status: "running" | "complete",
): Promise<void> {
  const toolCallId = ai.toolCallId() ?? panel.id;
  const { waitUntilComplete } = chat.stream.writer({
    target: "root",
    execute: ({ write }) => {
      write({
        type: "data-panel",
        id: toolCallId,
        data: { ...panel, status },
      });
      write({
        type: "data-dag-node",
        id: `node-${toolCallId}`,
        data: {
          id: panel.arm,
          label: panel.eyebrow,
          detail:
            status === "running" ? "Querying ClickHouse…" : panel.finding,
          arm: panel.arm,
          status,
          score: panel.sampledScore,
        },
      });
    },
  });
  await waitUntilComplete();
}
