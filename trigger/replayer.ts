import { schedules } from "@trigger.dev/sdk";
import { readIncidentLabels } from "@/lib/clickhouse/incidents";
import { recordReward } from "@/lib/clickhouse/rewards";

export const simulatedSreReplayer = schedules.task({
  id: "simulated-sre-replayer",
  cron: "*/10 * * * *",
  run: async () => {
    const episodeId = crypto.randomUUID();
    const labeledIncidents = await readIncidentLabels();

    await Promise.all(
      labeledIncidents.map((incident, index) =>
        recordReward({
          episodeId,
          contextBucket: incident.contextBucket,
          arm: incident.bestArm,
          panelId: `replay-${incident.bestArm}-${index}`,
          eventType: index === 0 ? "confirm_root_cause" : "click",
          value: index === 0 ? 1 : 0.72,
          propensity: 0.2,
        }),
      ),
    );

    return {
      source: "simulated-sre-bootstrap",
      disclosed: true,
      episodes: labeledIncidents.length,
    };
  },
});
