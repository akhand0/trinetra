import { recordReward } from "@/lib/clickhouse/rewards";
import { confirmEpisode } from "@/lib/postgres/episodes";
import type { RewardEvent } from "@/lib/types";
import { z } from "zod";

export const runtime = "nodejs";

const rewardSchema = z.object({
  episodeId: z.string().min(1),
  contextBucket: z.enum([
    "latency_after_deploy",
    "latency_general",
    "errors_spike",
    "trace_lookup",
    "capacity",
    "unknown",
  ]),
  arm: z.enum([
    "latency_shift",
    "error_cluster",
    "deploy_correlation",
    "trace_mining",
    "cardinality_scan",
  ]),
  panelId: z.string().min(1),
  eventType: z.enum([
    "impression",
    "dwell",
    "click",
    "expand",
    "drilldown",
    "confirm_root_cause",
  ]),
  value: z.number().min(0).max(1),
  propensity: z.number().min(0).max(1),
});

export async function POST(request: Request) {
  const parsed = rewardSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid reward event", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const event = parsed.data as RewardEvent;
  await recordReward(event);

  if (event.eventType === "confirm_root_cause") {
    await confirmEpisode(event.episodeId);
  }

  return Response.json({ accepted: true });
}
