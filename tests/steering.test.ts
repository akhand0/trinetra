import { describe, expect, it } from "vitest";
import { applyEvidence, nextArm } from "@/lib/policy/steering";
import { INITIAL_POSTERIORS } from "@/lib/telemetry/mock-data";
import type { Posterior, ProbeArm } from "@/lib/types";

function meanOf(posteriors: Posterior[], arm: ProbeArm): number {
  return posteriors.find((posterior) => posterior.arm === arm)!.mean;
}

describe("mid-episode steering", () => {
  it("promotes trace mining after a concentrated error cluster", () => {
    const { promoted, posteriors } = applyEvidence(INITIAL_POSTERIORS, {
      arm: "error_cluster",
      finding: "Errors concentrated on a single service.",
      confidence: 91,
    });
    expect(promoted).toBe("trace_mining");
    expect(meanOf(posteriors, "trace_mining")).toBeGreaterThan(
      meanOf(INITIAL_POSTERIORS, "trace_mining"),
    );
  });

  it("does not promote when the cue is a different arm", () => {
    const { promoted } = applyEvidence(INITIAL_POSTERIORS, {
      arm: "latency_shift",
      finding: "p99 rose gradually across every service.",
      confidence: 88,
    });
    expect(promoted).toBeUndefined();
  });

  it("rewards the arm that produced the evidence", () => {
    const { posteriors } = applyEvidence(INITIAL_POSTERIORS, {
      arm: "deploy_correlation",
      finding: "Deploy aligns with the regression window.",
      confidence: 96,
    });
    expect(meanOf(posteriors, "deploy_correlation")).toBeGreaterThan(
      meanOf(INITIAL_POSTERIORS, "deploy_correlation"),
    );
  });

  it("re-samples only arms that have not run yet", () => {
    const executed: ProbeArm[] = [
      "latency_shift",
      "error_cluster",
      "deploy_correlation",
      "cardinality_scan",
    ];
    const pick = nextArm(INITIAL_POSTERIORS, executed, () => 0.5);
    expect(pick?.arm).toBe("trace_mining");
  });

  it("returns undefined once every arm has run", () => {
    const executed = INITIAL_POSTERIORS.map((posterior) => posterior.arm);
    expect(nextArm(INITIAL_POSTERIORS, executed)).toBeUndefined();
  });
});
