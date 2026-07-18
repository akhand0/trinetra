import { chooseArms, type PolicyChoice, posteriorAfterReward } from "./thompson";
import type { Posterior, ProbeArm } from "@/lib/types";

export interface ProbeEvidence {
  arm: ProbeArm;
  finding: string;
  /** Panel confidence on a 0–100 scale. */
  confidence: number;
}

const CONCENTRATED = /concentrat|single service|one service|isolated|localized/i;

/**
 * Fold a completed probe's evidence back into the posterior mid-episode. The
 * arm that just ran is rewarded by its evidence strength, and a concentrated
 * error cluster promotes trace mining — the same shift the demo canvas makes
 * when a user opens the error-cluster panel. This is the inner learning loop:
 * the posterior the policy samples from changes while the answer is assembling.
 */
export function applyEvidence(
  posteriors: Posterior[],
  evidence: ProbeEvidence,
): { posteriors: Posterior[]; promoted?: ProbeArm } {
  const value = clamp01(evidence.confidence / 100);
  let promoted: ProbeArm | undefined;

  let next = posteriors.map((posterior) =>
    posterior.arm === evidence.arm
      ? posteriorAfterReward(posterior, value)
      : posterior,
  );

  const concentratedError =
    evidence.arm === "error_cluster" &&
    (value >= 0.7 || CONCENTRATED.test(evidence.finding));

  if (concentratedError) {
    promoted = "trace_mining";
    next = next.map((posterior) =>
      posterior.arm === "trace_mining"
        ? posteriorAfterReward(posteriorAfterReward(posterior, 1), 1)
        : posterior,
    );
  }

  return { posteriors: next, promoted };
}

/**
 * Re-sample the arms that have not run yet and return the top pick, or
 * undefined when every arm has already been probed.
 */
export function nextArm(
  posteriors: Posterior[],
  executed: Iterable<ProbeArm>,
  random?: () => number,
): PolicyChoice | undefined {
  const done = new Set(executed);
  const remaining = posteriors.filter((posterior) => !done.has(posterior.arm));
  if (remaining.length === 0) return undefined;
  return chooseArms(remaining, 1, random)[0];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
