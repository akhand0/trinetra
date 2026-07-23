import { logger, schedules } from "@trigger.dev/sdk";
import { runDetectionCycle } from "@/lib/clickhouse/detections";

/**
 * Deterministic, zero-AI telemetry sweep. The declarative schedule is synced
 * by `trigger dev` and `trigger deploy`; a single-worker queue prevents two
 * sweeps from racing incident lifecycle updates.
 */
export const alwaysOnDetection = schedules.task({
  id: "always-on-detection",
  cron: {
    pattern: "*/5 * * * *",
    timezone: "UTC",
    environments: ["PRODUCTION"],
  },
  queue: {
    concurrencyLimit: 1,
  },
  ttl: "4m",
  retry: {
    maxAttempts: 3,
  },
  run: async (payload) => {
    const snapshot = await runDetectionCycle({
      source: "scheduled",
      cycleId: `schedule:${payload.timestamp.toISOString()}`,
      evaluatedAt: payload.timestamp,
    });

    logger.info("Always-on detection sweep completed", {
      activeIncidents: snapshot.activeIncidents.length,
      servicesMonitored: snapshot.servicesMonitored,
      telemetryWatermark: snapshot.telemetryWatermark,
      detectorStatuses: Object.fromEntries(
        snapshot.detectors.map((detector) => [
          detector.detectorId,
          detector.status,
        ]),
      ),
    });

    return {
      activeIncidents: snapshot.activeIncidents.length,
      servicesMonitored: snapshot.servicesMonitored,
      telemetryWatermark: snapshot.telemetryWatermark,
      detectors: snapshot.detectors.map((detector) => ({
        id: detector.detectorId,
        status: detector.status,
        finding: detector.finding,
      })),
    };
  },
});
