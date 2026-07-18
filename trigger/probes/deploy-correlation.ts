import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { PANELS } from "@/lib/telemetry/mock-data";
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
    await streamPanel(PANELS.deploy, "running");
    const rowCount = await runProbeQuery("deploy_correlation");
    await streamPanel(PANELS.deploy, "complete");
    return {
      finding: PANELS.deploy.finding,
      confidence: PANELS.deploy.confidence,
      rowCount,
    };
  },
});
