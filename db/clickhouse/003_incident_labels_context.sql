-- Adds context_bucket to incident_labels for instances provisioned before the
-- column existed. Fresh setups already get it from 001_schema.sql.
-- Apply with: clickhouse-client --multiquery < db/clickhouse/003_incident_labels_context.sql

ALTER TABLE incident_labels
  ADD COLUMN IF NOT EXISTS context_bucket LowCardinality(String) AFTER window_end;
