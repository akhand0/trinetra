-- Trinetra demo telemetry tables (synthetic-seed ingest path)
-- Apply with: clickhouse-client --multiquery < db/clickhouse/004_demo_telemetry.sql
--
-- These are the raw logs/metrics/spans tables written by datagen/seed.ts. They
-- are ONLY for the hand-rolled 5-service demo. If you run the real
-- OpenTelemetry Demo, use db/clickhouse/005_otel_views.sql instead — it defines
-- logs/metrics/spans as VIEWS over the collector's otel_* tables. The two paths
-- are mutually exclusive: apply 004 OR 005, never both.

CREATE TABLE IF NOT EXISTS logs
(
  ts DateTime64(3, 'UTC'),
  service LowCardinality(String),
  level LowCardinality(String),
  message String,
  trace_id String,
  attrs Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (service, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS metrics
(
  ts DateTime64(3, 'UTC'),
  service LowCardinality(String),
  name LowCardinality(String),
  value Float64,
  tags Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (service, name, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS spans
(
  trace_id String,
  span_id String,
  parent_id String,
  service LowCardinality(String),
  op LowCardinality(String),
  ts DateTime64(3, 'UTC'),
  duration_ms Float64,
  status LowCardinality(String),
  attrs Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (service, ts, trace_id)
TTL toDateTime(ts) + INTERVAL 30 DAY;
