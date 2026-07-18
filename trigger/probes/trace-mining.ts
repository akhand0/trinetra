import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { PANELS } from "@/lib/telemetry/mock-data";
import { runProbeQuery, streamPanel } from "./shared";

export const traceMiningProbe = schemaTask({
  id: "probe-trace-mining",
  description:
    "Mine the slowest distributed traces and stream a highlighted waterfall.",
  schema: z.object({
    query: z.string(),
    episodeId: z.string(),
  }),
  run: async () => {
    await streamPanel(PANELS.trace, "running");
    const rowCount = await runProbeQuery("trace_mining");
    await streamPanel(PANELS.trace, "complete");
    return {
      finding: PANELS.trace.finding,
      confidence: PANELS.trace.confidence,
      rowCount,
    };
  },
});
