import { clickhouse, hasClickHouseConfig } from "@/lib/clickhouse/client";
import {
  LABELED_INCIDENTS,
  type LabeledIncident,
} from "@/lib/telemetry/incident-labels";
import type { ContextBucket, ProbeArm } from "@/lib/types";

export interface IncidentLabel {
  contextBucket: ContextBucket;
  bestArm: ProbeArm;
}

const fallbackLabels: IncidentLabel[] = LABELED_INCIDENTS.map((incident) => ({
  contextBucket: incident.contextBucket,
  bestArm: incident.bestArm,
}));

export async function readIncidentLabels(): Promise<IncidentLabel[]> {
  if (!hasClickHouseConfig()) return fallbackLabels;

  const result = await clickhouse().query({
    query: `
      SELECT context_bucket, best_arm
      FROM incident_labels
      ORDER BY window_start
    `,
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    context_bucket: ContextBucket;
    best_arm: ProbeArm;
  }>();

  if (rows.length === 0) return fallbackLabels;

  return rows.map((row) => ({
    contextBucket: row.context_bucket,
    bestArm: row.best_arm,
  }));
}

export async function seedIncidentLabels(): Promise<number> {
  if (!hasClickHouseConfig()) return 0;

  const now = Date.now();
  const values = LABELED_INCIDENTS.map((incident: LabeledIncident, index) => {
    const windowStart = new Date(now - (index + 1) * 60 * 60 * 1000);
    const windowEnd = new Date(now - index * 60 * 60 * 1000);
    return {
      incident_id: crypto.randomUUID(),
      window_start: toClickHouseSeconds(windowStart),
      window_end: toClickHouseSeconds(windowEnd),
      context_bucket: incident.contextBucket,
      culprit_service: incident.culpritService,
      culprit_kind: incident.culpritKind,
      best_arm: incident.bestArm,
      notes: incident.notes,
    };
  });

  await clickhouse().insert({
    table: "incident_labels",
    values,
    format: "JSONEachRow",
  });

  return values.length;
}

function toClickHouseSeconds(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}
