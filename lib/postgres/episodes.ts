import { hasPostgresConfig, postgres } from "@/lib/postgres/client";
import type { PolicyChoice } from "@/lib/policy/thompson";
import type { ContextBucket } from "@/lib/types";

export async function createEpisode(input: {
  id: string;
  chatId: string;
  query: string;
  context: ContextBucket;
}): Promise<void> {
  if (!hasPostgresConfig()) return;
  await postgres().query(
    `INSERT INTO episodes (id, chat_id, query, context_bucket, started_at, status)
     VALUES ($1, $2, $3, $4, NOW(), 'running')
     ON CONFLICT (id) DO NOTHING`,
    [input.id, input.chatId, input.query, input.context],
  );
}

export async function recordDecision(
  episodeId: string,
  step: number,
  choice: PolicyChoice,
): Promise<void> {
  if (!hasPostgresConfig()) return;
  await postgres().query(
    `INSERT INTO policy_decisions
      (episode_id, step, arm, sampled_score, propensity, decided_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      episodeId,
      step,
      choice.arm,
      choice.sampledScore,
      choice.propensity,
    ],
  );
}

export async function confirmEpisode(episodeId: string): Promise<void> {
  if (!hasPostgresConfig()) return;
  await postgres().query(
    `UPDATE episodes
     SET status = 'resolved', root_cause_confirmed = TRUE, closed_at = NOW()
     WHERE id = $1`,
    [episodeId],
  );
}
