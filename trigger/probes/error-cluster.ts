import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { panelTemplate } from "@/lib/telemetry/panels";
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
    const panel = panelTemplate("error_cluster");
    await streamPanel(panel, "running");
    const rowCount = await runProbeQuery("error_cluster");
    const finished = {
      ...panel,
      finding: `${rowCount} services ranked by error volume`,
    };
    await streamPanel(finished, "complete");
    return { finding: finished.finding, rowCount };
  },
});
