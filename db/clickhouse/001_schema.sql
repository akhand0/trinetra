-- Trinetra OLAP schema — learning/policy tables (ingest-path agnostic)
-- Apply with: clickhouse-client --multiquery < db/clickhouse/001_schema.sql
--
-- Raw telemetry (logs/metrics/spans) lives in a separate file so the two ingest
-- paths stay mutually exclusive:
--   * synthetic demo seed  -> db/clickhouse/004_demo_telemetry.sql (real tables)
--   * OpenTelemetry Demo    -> db/clickhouse/005_otel_views.sql   (views over otel_*)
-- Apply exactly one of those alongside this file.

CREATE TABLE IF NOT EXISTS reward_events
(
  ts DateTime64(3, 'UTC'),
  episode_id UUID,
  context_bucket LowCardinality(String),
  arm LowCardinality(String),
  panel_id String,
  event_type Enum8(
    'impression' = 0,
    'dwell' = 1,
    'click' = 2,
    'expand' = 3,
    'drilldown' = 4,
    'confirm_root_cause' = 5
  ),
  value Float32,
  propensity Float32,
  source LowCardinality(String) DEFAULT 'real'
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (context_bucket, arm, ts);

CREATE TABLE IF NOT EXISTS posterior_states
(
  context_bucket LowCardinality(String),
  arm LowCardinality(String),
  reward_sum AggregateFunction(sum, Float64),
  trials AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
ORDER BY (context_bucket, arm);

CREATE MATERIALIZED VIEW IF NOT EXISTS posterior_mv
TO posterior_states
AS
SELECT
  context_bucket,
  arm,
  sumState(toFloat64(value)) AS reward_sum,
  countState() AS trials
FROM reward_events
GROUP BY context_bucket, arm;

CREATE VIEW IF NOT EXISTS posterior_by_context
AS
SELECT
  context_bucket,
  arm,
  sumMerge(reward_sum) AS reward_sum,
  countMerge(trials) AS trials
FROM posterior_states
GROUP BY context_bucket, arm;

CREATE TABLE IF NOT EXISTS incident_labels
(
  incident_id UUID,
  window_start DateTime('UTC'),
  window_end DateTime('UTC'),
  context_bucket LowCardinality(String),
  culprit_service LowCardinality(String),
  culprit_kind LowCardinality(String),
  best_arm LowCardinality(String),
  notes String
)
ENGINE = MergeTree
ORDER BY incident_id;
