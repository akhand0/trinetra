import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { PANELS } from "@/lib/telemetry/mock-data";
import { runProbeQuery, streamPanel } from "./shared";

export const latencyShiftProbe = schemaTask({
  id: "probe-latency-shift",
  description:
    "Detect step changes in p50, p95, and p99 latency and stream a timeline panel.",
  schema: z.object({
    query: z.string(),
    episodeId: z.string(),
  }),
  run: async () => {
    await streamPanel(PANELS.timeline, "running");
    const rowCount = await runProbeQuery("latency_shift");
    await streamPanel(PANELS.timeline, "complete");
    return {
      finding: PANELS.timeline.finding,
      confidence: PANELS.timeline.confidence,
      rowCount,
    };
  },
});
