import { readLearningSummary } from "@/lib/clickhouse/rewards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await readLearningSummary().catch(() => null);

  if (!summary) {
    return Response.json(
      { error: "Live learning state is unavailable" },
      { status: 503 },
    );
  }

  const best = summary.posteriors[0]?.mean ?? 0;
  const worst = summary.posteriors.at(-1)?.mean ?? 0;
  const policyLift = Math.round((best - worst) * 100);

  return Response.json({
    posteriors: summary.posteriors,
    summary: {
      replayedEpisodes: summary.replayedEpisodes,
      rewardEvents: summary.rewardEvents,
      confirmedRoots: summary.confirmedRoots,
      policyLift,
    },
  });
}
