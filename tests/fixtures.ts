import type { Posterior } from "@/lib/types";

/** A varied posterior set used purely as a deterministic test fixture. */
export const POSTERIORS: Posterior[] = [
  {
    arm: "latency_shift",
    label: "Latency",
    alpha: 39,
    beta: 8,
    mean: 0.83,
    sampled: 0.89,
    trials: 45,
  },
  {
    arm: "error_cluster",
    label: "Errors",
    alpha: 31,
    beta: 10,
    mean: 0.76,
    sampled: 0.82,
    trials: 39,
  },
  {
    arm: "deploy_correlation",
    label: "Deploy",
    alpha: 26,
    beta: 12,
    mean: 0.68,
    sampled: 0.78,
    trials: 36,
  },
  {
    arm: "trace_mining",
    label: "Trace",
    alpha: 20,
    beta: 14,
    mean: 0.59,
    sampled: 0.63,
    trials: 32,
  },
  {
    arm: "cardinality_scan",
    label: "Cardinality",
    alpha: 8,
    beta: 18,
    mean: 0.31,
    sampled: 0.39,
    trials: 24,
  },
];
