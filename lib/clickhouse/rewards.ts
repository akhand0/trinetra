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

const ARM_LABELS: Record<Posterior["arm"], string> = {
  latency_shift: "Latency",
  error_cluster: "Errors",
  deploy_correlation: "Deploy",
  trace_mining: "Trace",
  cardinality_scan: "Cardinality",
};

export interface LearningSummary {
  posteriors: Posterior[];
  replayedEpisodes: number;
  rewardEvents: number;
  confirmedRoots: number;
}

/**
 * Reads the live learning state aggregated across every context bucket: the
 * per-arm posteriors from the AggregatingMergeTree view plus reward-stream
 * counts. Returns null when ClickHouse is unconfigured so the dashboard route
 * can fall back to its seeded snapshot.
 */
export async function readLearningSummary(): Promise<LearningSummary | null> {
  if (!hasClickHouseConfig()) return null;

  const client = clickhouse();

  const posteriorRows = await client
    .query({
      query: `
        SELECT
          arm,
          1 + reward_total AS alpha,
          1 + trial_total - reward_total AS beta,
          alpha / (alpha + beta) AS mean,
          trial_total AS trials
        FROM (
          SELECT
            arm,
            sum(reward_sum) AS reward_total,
            sum(trials) AS trial_total
          FROM posterior_by_context
          GROUP BY arm
        )
        ORDER BY mean DESC
      `,
      format: "JSONEachRow",
    })
    .then((r) =>
      r.json<{
        arm: Posterior["arm"];
        trials: number;
        alpha: number;
        beta: number;
        mean: number;
      }>(),
    );

  const [counts] = await client
    .query({
      query: `
        SELECT
          count() AS reward_events,
          uniq(episode_id) AS episodes,
          countIf(event_type = 'confirm_root_cause') AS confirmed
        FROM reward_events
      `,
      format: "JSONEachRow",
    })
    .then((r) =>
      r.json<{ reward_events: number; episodes: number; confirmed: number }>(),
    );

  const posteriors: Posterior[] =
    posteriorRows.length === 0
      ? INITIAL_POSTERIORS
      : posteriorRows.map((row) => ({
          arm: row.arm,
          label: ARM_LABELS[row.arm],
          alpha: Number(row.alpha),
          beta: Number(row.beta),
          mean: Number(row.mean),
          sampled: Number(row.mean),
          trials: Number(row.trials),
        }));

  return {
    posteriors,
    replayedEpisodes: Number(counts?.episodes ?? 0),
    rewardEvents: Number(counts?.reward_events ?? 0),
    confirmedRoots: Number(counts?.confirmed ?? 0),
  };
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
