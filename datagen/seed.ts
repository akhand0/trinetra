import { clickhouse, hasClickHouseConfig } from "@/lib/clickhouse/client";
import { seedIncidentLabels } from "@/lib/clickhouse/incidents";

const services = [
  "web-gateway",
  "checkout-api",
  "payments-api",
  "inventory-api",
  "fraud-service",
] as const;

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clickhouseTimestamp(date: Date) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

async function seed() {
  if (!hasClickHouseConfig()) {
    throw new Error(
      "CLICKHOUSE_URL is required to seed cloud telemetry. The web app itself still works in local demo mode.",
    );
  }

  const random = seeded(2048);
  const now = Date.now();
  const deployAt = now - 52 * 60 * 1000;
  const metrics: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const spans: Record<string, unknown>[] = [];

  for (let minute = 180; minute >= 0; minute--) {
    const ts = new Date(now - minute * 60_000);
    for (const service of services) {
      const afterDeploy = ts.getTime() >= deployAt;
      const affected = service === "payments-api" && afterDeploy;
      const baseLatency = 48 + random() * 18;
      metrics.push({
        ts: clickhouseTimestamp(ts),
        service,
        name: "http.server.duration",
        value: affected ? 220 + random() * 90 : baseLatency,
        tags: {
          environment: "production",
          percentile: "p99",
          version: affected ? "2.14.0" : "2.13.7",
        },
      });
      metrics.push({
        ts: clickhouseTimestamp(ts),
        service,
        name: "db.pool.waiting",
        value: affected ? 38 + random() * 11 : random() * 3,
        tags: { environment: "production", pool: "primary" },
      });

      if (affected && random() > 0.45) {
        const traceId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
        logs.push({
          ts: clickhouseTimestamp(ts),
          service,
          level: "error",
          message: "timeout acquiring Postgres connection",
          trace_id: traceId,
          attrs: {
            "error.kind": "PoolAcquireTimeout",
            "deployment.version": "2.14.0",
          },
        });
        spans.push({
          trace_id: traceId,
          span_id: crypto.randomUUID().slice(0, 8),
          parent_id: "",
          service,
          op: "pool.acquire",
          ts: clickhouseTimestamp(ts),
          duration_ms: 220 + random() * 70,
          status: "error",
          attrs: { "db.system": "postgresql" },
        });
      }
    }
  }

  logs.push({
    ts: clickhouseTimestamp(new Date(deployAt)),
    service: "payments-api",
    level: "info",
    message: "deployed v2.14.0; DB_POOL_MAX 40 -> 12",
    trace_id: "",
    attrs: {
      "event.kind": "deployment",
      "deployment.version": "2.14.0",
      "git.commit": "6d14f2c",
    },
  });

  const client = clickhouse();
  await client.insert({ table: "metrics", values: metrics, format: "JSONEachRow" });
  await client.insert({ table: "logs", values: logs, format: "JSONEachRow" });
  await client.insert({ table: "spans", values: spans, format: "JSONEachRow" });

  const labels = await seedIncidentLabels();

  console.log(
    `Seeded ${metrics.length} metrics, ${logs.length} logs, ${spans.length} spans, and ${labels} incident labels.`,
  );
}

void seed();
