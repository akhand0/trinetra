import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { panelTemplate } from "@/lib/telemetry/panels";
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
    const panel = panelTemplate("trace_mining");
    await streamPanel(panel, "running");
    const rowCount = await runProbeQuery("trace_mining");
    const finished = {
      ...panel,
      finding: `${rowCount} traces ranked by total duration`,
    };
    await streamPanel(finished, "complete");
    return { finding: finished.finding, rowCount };
  },
});
