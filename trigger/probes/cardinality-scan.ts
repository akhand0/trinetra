import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { PANELS } from "@/lib/telemetry/mock-data";
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
    await streamPanel(PANELS.cardinality, "running");
    const rowCount = await runProbeQuery("cardinality_scan");
    await streamPanel(PANELS.cardinality, "complete");
    return {
      finding: PANELS.cardinality.finding,
      confidence: PANELS.cardinality.confidence,
      rowCount,
    };
  },
});
