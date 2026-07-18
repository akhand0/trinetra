import { describe, expect, it } from "vitest";
import { classifyContext } from "@/lib/policy/context";
import {
  betaSample,
  chooseArms,
  posteriorAfterReward,
} from "@/lib/policy/thompson";
import { POSTERIORS } from "./fixtures";

function deterministicRandom(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length] ?? 0.5;
}

describe("context bucketing", () => {
  it("recognizes latency after deployment", () => {
    expect(
      classifyContext("Why did checkout p99 spike after Tuesday's deploy?"),
    ).toBe("latency_after_deploy");
  });

  it("falls back without overfitting", () => {
    expect(classifyContext("What happened?")).toBe("unknown");
  });
});

describe("Thompson policy", () => {
  it("returns bounded beta samples", () => {
    const sample = betaSample(
      5,
      3,
      deterministicRandom([0.62, 0.41, 0.88, 0.36, 0.73]),
    );
    expect(sample).toBeGreaterThanOrEqual(0);
    expect(sample).toBeLessThanOrEqual(1);
  });

  it("logs a normalized propensity for every selected arm", () => {
    const choices = chooseArms(
      POSTERIORS,
      3,
      deterministicRandom([0.23, 0.51, 0.77, 0.42, 0.89, 0.33, 0.68]),
    );
    expect(choices).toHaveLength(3);
    for (const choice of choices) {
      expect(choice.propensity).toBeGreaterThan(0);
      expect(choice.propensity).toBeLessThanOrEqual(1);
    }
  });

  it("moves the posterior mean upward after positive feedback", () => {
    const before = POSTERIORS[0];
    const after = posteriorAfterReward(before, 1);
    expect(after.mean).toBeGreaterThan(before.mean);
    expect(after.trials).toBe(before.trials + 1);
  });
});
