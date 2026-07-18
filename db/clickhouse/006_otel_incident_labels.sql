-- Trinetra ground-truth labels for the OpenTelemetry Demo's flagd failures.
-- Apply with: clickhouse-client --multiquery < db/clickhouse/006_otel_incident_labels.sql
--
-- The synthetic-seed path writes incident_labels from lib/telemetry/incident-labels.ts.
-- The real OTel Demo has no such seed step, so these rows give the replayer the
-- same known-root-cause bootstrap for the Demo's built-in feature flags. Each
-- flag manufactures a specific failure in a specific service — that IS the
-- disclosed ground truth. Enable a flag in the flagd UI, let telemetry flow,
-- and the labeled best_arm is the probe that localizes it.
--
-- window_start/window_end are placeholders (fixed 1h windows ending "now");
-- the replayer keys off context_bucket + best_arm, not the exact window.

INSERT INTO incident_labels
  (incident_id, window_start, window_end, context_bucket, culprit_service, culprit_kind, best_arm, notes)
VALUES
  (generateUUIDv4(), now() - INTERVAL 1 HOUR, now(), 'errors_spike',
   'payment', 'flag_payment_service_failure', 'error_cluster',
   'flagd paymentServiceFailure: charge calls throw; errors concentrate on payment.'),
  (generateUUIDv4(), now() - INTERVAL 2 HOUR, now() - INTERVAL 1 HOUR, 'errors_spike',
   'payment', 'flag_payment_service_unreachable', 'deploy_correlation',
   'flagd paymentServiceUnreachable: payment endpoint drops; onset aligns with the flag flip.'),
  (generateUUIDv4(), now() - INTERVAL 3 HOUR, now() - INTERVAL 2 HOUR, 'errors_spike',
   'cart', 'flag_cart_service_failure', 'trace_mining',
   'flagd cartServiceFailure: EmptyCart RPC fails; slow/error spans trace back to cart.'),
  (generateUUIDv4(), now() - INTERVAL 4 HOUR, now() - INTERVAL 3 HOUR, 'errors_spike',
   'product-catalog', 'flag_product_catalog_failure', 'error_cluster',
   'flagd productCatalogFailure: GetProduct errors for a specific product id.'),
  (generateUUIDv4(), now() - INTERVAL 5 HOUR, now() - INTERVAL 4 HOUR, 'capacity',
   'recommendation', 'flag_recommendation_cache_failure', 'cardinality_scan',
   'flagd recommendationServiceCacheFailure: unbounded cache growth inflates memory/cardinality.'),
  (generateUUIDv4(), now() - INTERVAL 6 HOUR, now() - INTERVAL 5 HOUR, 'latency_general',
   'ad', 'flag_ad_service_high_cpu', 'latency_shift',
   'flagd adServiceHighCpu: CPU saturation raises ad-service p99.'),
  (generateUUIDv4(), now() - INTERVAL 7 HOUR, now() - INTERVAL 6 HOUR, 'latency_general',
   'ad', 'flag_ad_service_manual_gc', 'latency_shift',
   'flagd adServiceManualGc: forced GC pauses produce periodic latency spikes.'),
  (generateUUIDv4(), now() - INTERVAL 8 HOUR, now() - INTERVAL 7 HOUR, 'capacity',
   'checkout', 'flag_kafka_queue_problems', 'cardinality_scan',
   'flagd kafkaQueueProblems: Kafka backlog builds; consumer lag drives queue-side latency.');
