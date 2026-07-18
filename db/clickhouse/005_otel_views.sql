-- Trinetra OpenTelemetry compatibility views (real OTel Demo ingest path)
-- Apply with: clickhouse-client --multiquery < db/clickhouse/005_otel_views.sql
--
-- The OTel Collector ClickHouse exporter auto-creates otel_logs, otel_traces,
-- and otel_metrics_* tables on first flush. These views re-expose those tables
-- under the logs/metrics/spans names + column shapes the probes already query,
-- so the agent needs no SQL changes when telemetry comes from the real
-- OpenTelemetry Demo (~20 microservices) instead of datagen/seed.ts.
--
-- Prerequisite: the collector must have written to otel_* at least once (the
-- exporter creates the tables lazily). Do NOT apply 004_demo_telemetry.sql on
-- the same instance — its real tables would collide with these view names.

DROP TABLE IF EXISTS logs;
DROP TABLE IF EXISTS metrics;
DROP TABLE IF EXISTS spans;

CREATE VIEW IF NOT EXISTS logs AS
SELECT
  Timestamp AS ts,
  ServiceName AS service,
  SeverityText AS level,
  Body AS message,
  TraceId AS trace_id,
  CAST(LogAttributes AS Map(String, String)) AS attrs
FROM otel_logs;

-- Metrics arrive split across per-type tables; the probes only need
-- (ts, service, name, value, tags), so union the two point-value shapes.
CREATE VIEW IF NOT EXISTS metrics AS
SELECT
  TimeUnix AS ts,
  ServiceName AS service,
  MetricName AS name,
  Value AS value,
  CAST(Attributes AS Map(String, String)) AS tags
FROM otel_metrics_gauge
UNION ALL
SELECT
  TimeUnix AS ts,
  ServiceName AS service,
  MetricName AS name,
  Value AS value,
  CAST(Attributes AS Map(String, String)) AS tags
FROM otel_metrics_sum;

CREATE VIEW IF NOT EXISTS spans AS
SELECT
  TraceId AS trace_id,
  SpanId AS span_id,
  ParentSpanId AS parent_id,
  ServiceName AS service,
  SpanName AS op,
  Timestamp AS ts,
  Duration / 1e6 AS duration_ms,
  StatusCode AS status,
  CAST(SpanAttributes AS Map(String, String)) AS attrs
FROM otel_traces;
