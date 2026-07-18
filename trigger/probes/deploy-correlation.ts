import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { panelTemplate } from "@/lib/telemetry/panels";
import { runProbeQuery, streamPanel } from "./shared";

export const deployCorrelationProbe = schemaTask({
  id: "probe-deploy-correlation",
  description:
    "Correlate anomaly boundaries with deploy events and configuration diffs.",
  schema: z.object({
    query: z.string(),
    episodeId: z.string(),
  }),
  run: async () => {
    const panel = panelTemplate("deploy_correlation");
    await streamPanel(panel, "running");
    const rowCount = await runProbeQuery("deploy_correlation");
    const finished = {
      ...panel,
      finding: `${rowCount} deploy events correlated`,
    };
    await streamPanel(finished, "complete");
    return { finding: finished.finding, rowCount };
  },
});
