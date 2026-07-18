import { readLearningSummary } from "@/lib/clickhouse/rewards";
import { INITIAL_POSTERIORS, LEARNING_CURVE } from "@/lib/telemetry/mock-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await readLearningSummary().catch(() => null);

  if (!summary) {
    return Response.json({
      source: "seeded-replayer",
      curve: LEARNING_CURVE,
      posteriors: INITIAL_POSTERIORS,
      summary: {
        replayedEpisodes: 312,
        rewardEvents: 2847,
        confirmedRoots: 263,
        policyLift: 42,
      },
    });
  }

  const best = summary.posteriors[0]?.mean ?? 0;
  const worst = summary.posteriors.at(-1)?.mean ?? 0;
  const policyLift = Math.round((best - worst) * 100);

  return Response.json({
    source: "clickhouse",
    curve: LEARNING_CURVE,
    posteriors: summary.posteriors,
    summary: {
      replayedEpisodes: summary.replayedEpisodes,
      rewardEvents: summary.rewardEvents,
      confirmedRoots: summary.confirmedRoots,
      policyLift,
    },
  });
}
