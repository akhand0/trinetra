import {
  INITIAL_POSTERIORS,
  LEARNING_CURVE,
} from "@/lib/telemetry/mock-data";

export async function GET() {
  return Response.json({
    source: process.env.CLICKHOUSE_URL ? "clickhouse" : "seeded-replayer",
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
