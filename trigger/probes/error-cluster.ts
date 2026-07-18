import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { PANELS } from "@/lib/telemetry/mock-data";
import { runProbeQuery, streamPanel } from "./shared";

export const errorClusterProbe = schemaTask({
  id: "probe-error-cluster",
  description:
    "Cluster error logs by service and time and stream an error heatmap panel.",
  schema: z.object({
    query: z.string(),
    episodeId: z.string(),
  }),
  run: async () => {
    await streamPanel(PANELS.heatmap, "running");
    const rowCount = await runProbeQuery("error_cluster");
    await streamPanel(PANELS.heatmap, "complete");
    return {
      finding: PANELS.heatmap.finding,
      confidence: PANELS.heatmap.confidence,
      rowCount,
    };
  },
});
