import { clickhouse, hasClickHouseConfig } from "@/lib/clickhouse/client";
import { INITIAL_POSTERIORS } from "@/lib/telemetry/mock-data";
import type { ContextBucket, Posterior, RewardEvent } from "@/lib/types";

export async function recordReward(event: RewardEvent): Promise<void> {
  if (!hasClickHouseConfig()) return;

  await clickhouse().insert({
    table: "reward_events",
    format: "JSONEachRow",
    values: [
      {
        ts: new Date().toISOString().replace("T", " ").replace("Z", ""),
        episode_id: event.episodeId,
        context_bucket: event.contextBucket,
        arm: event.arm,
        panel_id: event.panelId,
        event_type: event.eventType,
        value: event.value,
        propensity: event.propensity,
      },
    ],
  });
}

export async function readPosteriors(
  context: ContextBucket,
): Promise<Posterior[]> {
  if (!hasClickHouseConfig()) return INITIAL_POSTERIORS;

  const result = await clickhouse().query({
    query: `
      SELECT
        arm,
        reward_sum,
        trials,
        1 + reward_sum AS alpha,
        1 + trials - reward_sum AS beta,
        alpha / (alpha + beta) AS mean
      FROM posterior_by_context
      WHERE context_bucket = {context:String}
      ORDER BY mean DESC
    `,
    query_params: { context },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    arm: Posterior["arm"];
    reward_sum: number;
    trials: number;
    alpha: number;
    beta: number;
    mean: number;
  }>();

  if (rows.length === 0) return INITIAL_POSTERIORS;

  const labels: Record<Posterior["arm"], string> = {
    latency_shift: "Latency",
    error_cluster: "Errors",
    deploy_correlation: "Deploy",
    trace_mining: "Trace",
    cardinality_scan: "Cardinality",
  };

  return rows.map((row) => ({
    arm: row.arm,
    label: labels[row.arm],
    alpha: Number(row.alpha),
    beta: Number(row.beta),
    mean: Number(row.mean),
    sampled: Number(row.mean),
    trials: Number(row.trials),
  }));
}
