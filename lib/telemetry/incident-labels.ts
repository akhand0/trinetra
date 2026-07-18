import type { ContextBucket, ProbeArm } from "@/lib/types";

export interface LabeledIncident {
  contextBucket: Extract<
    ContextBucket,
    "latency_after_deploy" | "errors_spike" | "capacity"
  >;
  bestArm: ProbeArm;
  culpritService: string;
  culpritKind: string;
  notes: string;
}

/**
 * Disclosed simulated-SRE ground truth. The seed writes these into the
 * ClickHouse `incident_labels` table; the replayer reads them back to replay
 * labeled rewards. Kept here as the single source of truth so the seed and the
 * replayer's offline fallback never drift apart.
 */
export const LABELED_INCIDENTS: LabeledIncident[] = [
  {
    contextBucket: "latency_after_deploy",
    bestArm: "deploy_correlation",
    culpritService: "payments-api",
    culpritKind: "connection_pool_regression",
    notes: "Deploy v2.14.0 cut DB_POOL_MAX 40 -> 12; queueing drives p99.",
  },
  {
    contextBucket: "latency_after_deploy",
    bestArm: "latency_shift",
    culpritService: "payments-api",
    culpritKind: "latency_regression",
    notes: "p99 step change 4 minutes after the v2.14.0 rollout.",
  },
  {
    contextBucket: "errors_spike",
    bestArm: "error_cluster",
    culpritService: "payments-api",
    culpritKind: "pool_acquire_timeout",
    notes: "PoolAcquireTimeout errors concentrate on payments-api.",
  },
  {
    contextBucket: "capacity",
    bestArm: "cardinality_scan",
    culpritService: "inventory-api",
    culpritKind: "tag_cardinality_blowup",
    notes: "High distinct tag-key count inflates metric cardinality.",
  },
  {
    contextBucket: "latency_after_deploy",
    bestArm: "trace_mining",
    culpritService: "payments-api",
    culpritKind: "slow_pool_acquire_span",
    notes: "pool.acquire spans dominate the slowest traces post-deploy.",
  },
];
