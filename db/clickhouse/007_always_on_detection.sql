-- Trinetra always-on detection state.
-- The application creates these tables lazily as well, so local demos do not
-- require a separate migration step.

CREATE TABLE IF NOT EXISTS trinetra_detector_runs
(
    evaluated_at DateTime64(3, 'UTC'),
    cycle_id String,
    detector_id LowCardinality(String),
    detector_name String,
    detector_description String,
    status LowCardinality(String),
    severity LowCardinality(String),
    service String,
    observed Nullable(Float64),
    baseline Nullable(Float64),
    threshold Nullable(Float64),
    unit LowCardinality(String),
    finding String,
    window_start DateTime64(3, 'UTC'),
    window_end DateTime64(3, 'UTC'),
    matched_series UInt32,
    sample_count UInt64,
    services_monitored UInt32,
    telemetry_watermark Nullable(DateTime64(3, 'UTC')),
    source LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toDate(evaluated_at)
ORDER BY (detector_id, evaluated_at, cycle_id)
TTL evaluated_at + INTERVAL 30 DAY DELETE;

CREATE TABLE IF NOT EXISTS trinetra_detection_incidents
(
    incident_id String,
    fingerprint FixedString(64),
    detector_id LowCardinality(String),
    opened_at DateTime64(3, 'UTC'),
    last_seen_at DateTime64(3, 'UTC'),
    updated_at DateTime64(3, 'UTC'),
    status LowCardinality(String),
    severity LowCardinality(String),
    service String,
    title String,
    summary String,
    observed Nullable(Float64),
    baseline Nullable(Float64),
    threshold Nullable(Float64),
    unit LowCardinality(String),
    window_start DateTime64(3, 'UTC'),
    window_end DateTime64(3, 'UTC'),
    occurrence_count UInt32,
    sample_count UInt64,
    cycle_id String,
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY incident_id;
