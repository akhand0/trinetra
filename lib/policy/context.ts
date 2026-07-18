import type { ContextBucket } from "@/lib/types";

export function classifyContext(query: string): ContextBucket {
  const normalized = query.toLowerCase();

  if (
    /(slow|latency|p99|response time)/.test(normalized) &&
    /(deploy|release|rollout|tuesday)/.test(normalized)
  ) {
    return "latency_after_deploy";
  }
  if (/(slow|latency|p99|response time)/.test(normalized)) {
    return "latency_general";
  }
  if (/(error|5xx|failure|exception)/.test(normalized)) {
    return "errors_spike";
  }
  if (/(trace|span|trace_id)/.test(normalized)) {
    return "trace_lookup";
  }
  if (/(memory|cpu|pool|capacity|cardinality)/.test(normalized)) {
    return "capacity";
  }
  return "unknown";
}
