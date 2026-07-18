import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { panelTemplate } from "@/lib/telemetry/panels";
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
    const panel = panelTemplate("latency_shift");
    await streamPanel(panel, "running");
    const rowCount = await runProbeQuery("latency_shift");
    const finished = {
      ...panel,
      finding: `${rowCount} latency buckets scanned`,
    };
    await streamPanel(finished, "complete");
    return { finding: finished.finding, rowCount };
  },
});
