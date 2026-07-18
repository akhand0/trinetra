import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { panelTemplate } from "@/lib/telemetry/panels";
import { runProbeQuery, streamPanel } from "./shared";

export const cardinalityScanProbe = schemaTask({
  id: "probe-cardinality-scan",
  description:
    "Check for metric label explosions and hot partitions; report negative evidence.",
  schema: z.object({
    query: z.string(),
    episodeId: z.string(),
  }),
  run: async () => {
    const panel = panelTemplate("cardinality_scan");
    await streamPanel(panel, "running");
    const rowCount = await runProbeQuery("cardinality_scan");
    const finished = {
      ...panel,
      finding: `${rowCount} services scanned for tag cardinality`,
    };
    await streamPanel(finished, "complete");
    return { finding: finished.finding, rowCount };
  },
});
