import { clickhouse, hasClickHouseConfig } from "@/lib/clickhouse/client";

export interface LiveTelemetry {
  windowMinutes: number;
  services: number;
  spanCount: number;
  latencySeries: { label: string; value: number }[];
  topLatencyService: string | null;
  topLatencyP99Ms: number | null;
  baselineP99Ms: number | null;
  errorSpans: number;
  topErrorService: string | null;
  errorLogs: number;
  slowestTrace: {
    service: string;
    op: string;
    durationMs: number;
    traceId: string;
  } | null;
  metricNames: number;
}

async function scalar<T>(query: string): Promise<T | null> {
  const result = await clickhouse().query({ query, format: "JSONEachRow" });
  const rows = await result.json<Record<string, T>>();
  const first = rows[0];
  if (!first) return null;
  return Object.values(first)[0] ?? null;
}

/**
 * Reads a compact live summary straight from the OTel-backed logs/metrics/spans
 * views. Returns null when ClickHouse is not configured or any query fails so
 * callers can report that live telemetry is unavailable. This is the app's
 * only investigation read path over the running collector stream.
 */
export async function readLiveTelemetry(
  windowMinutes = 15,
): Promise<LiveTelemetry | null> {
  if (!hasClickHouseConfig()) return null;

  const w = `now() - INTERVAL ${Math.trunc(windowMinutes)} MINUTE`;

  try {
    const client = clickhouse();

    const [topLatency] = await client
      .query({
        query: `
          SELECT service, round(quantile(0.99)(duration_ms), 1) AS p99
          FROM spans
          WHERE ts > ${w}
          GROUP BY service
          HAVING count() > 5
          ORDER BY p99 DESC
          LIMIT 1
        `,
        format: "JSONEachRow",
      })
      .then((r) => r.json<{ service: string; p99: number }>());

    const topLatencyService = topLatency?.service ?? null;

    const seriesRows = topLatencyService
      ? await client
          .query({
            query: `
              SELECT toString(toStartOfMinute(ts)) AS m,
                     round(quantile(0.99)(duration_ms), 1) AS p99
              FROM spans
              WHERE service = {service:String} AND ts > ${w}
              GROUP BY m ORDER BY m
            `,
            query_params: { service: topLatencyService },
            format: "JSONEachRow",
          })
          .then((r) => r.json<{ m: string; p99: number }>())
      : [];

    const latencySeries = seriesRows.map((row) => ({
      label: row.m.slice(11, 16),
      value: Number(row.p99),
    }));
    const baselineP99Ms = latencySeries.length
      ? Math.min(...latencySeries.map((point) => point.value))
      : null;

    const [topError] = await client
      .query({
        query: `
          SELECT service, count() AS c
          FROM spans
          WHERE ts > ${w} AND status = 'Error'
          GROUP BY service ORDER BY c DESC LIMIT 1
        `,
        format: "JSONEachRow",
      })
      .then((r) => r.json<{ service: string; c: number }>());

    const [slowest] = await client
      .query({
        query: `
          SELECT service, op, round(duration_ms, 1) AS d, trace_id
          FROM spans
          WHERE ts > ${w}
          ORDER BY duration_ms DESC LIMIT 1
        `,
        format: "JSONEachRow",
      })
      .then((r) =>
        r.json<{ service: string; op: string; d: number; trace_id: string }>(),
      );

    const services = await scalar<number>(
      `SELECT uniq(service) FROM spans WHERE ts > ${w}`,
    );
    const spanCount = await scalar<number>(
      `SELECT count() FROM spans WHERE ts > ${w}`,
    );
    const errorSpans = await scalar<number>(
      `SELECT count() FROM spans WHERE ts > ${w} AND status = 'Error'`,
    );
    const errorLogs = await scalar<number>(
      `SELECT count() FROM logs
       WHERE ts > ${w}
         AND (positionCaseInsensitive(level, 'err') > 0
              OR positionCaseInsensitive(level, 'fatal') > 0)`,
    );
    const metricNames = await scalar<number>(
      `SELECT uniqExact(name) FROM metrics WHERE ts > ${w}`,
    );

    return {
      windowMinutes,
      services: Number(services ?? 0),
      spanCount: Number(spanCount ?? 0),
      latencySeries,
      topLatencyService,
      topLatencyP99Ms: topLatency ? Number(topLatency.p99) : null,
      baselineP99Ms,
      errorSpans: Number(errorSpans ?? 0),
      topErrorService: topError?.service ?? null,
      errorLogs: Number(errorLogs ?? 0),
      slowestTrace: slowest
        ? {
            service: slowest.service,
            op: slowest.op,
            durationMs: Number(slowest.d),
            traceId: slowest.trace_id,
          }
        : null,
      metricNames: Number(metricNames ?? 0),
    };
  } catch {
    return null;
  }
}
