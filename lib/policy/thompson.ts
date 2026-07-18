import type { Posterior, ProbeArm } from "@/lib/types";

export interface PolicyChoice {
  arm: ProbeArm;
  sampledScore: number;
  propensity: number;
}

function normalSample(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  const v = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function gammaSample(shape: number, random: () => number): number {
  if (shape < 1) {
    return (
      gammaSample(shape + 1, random) *
      Math.pow(Math.max(random(), Number.EPSILON), 1 / shape)
    );
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (;;) {
    const x = normalSample(random);
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

export function betaSample(
  alpha: number,
  beta: number,
  random: () => number = Math.random,
): number {
  const x = gammaSample(alpha, random);
  const y = gammaSample(beta, random);
  return x / (x + y);
}

export function chooseArms(
  posteriors: Posterior[],
  count = 3,
  random: () => number = Math.random,
): PolicyChoice[] {
  const sampled = posteriors
    .map((posterior) => ({
      arm: posterior.arm,
      sampledScore: betaSample(posterior.alpha, posterior.beta, random),
    }))
    .sort((a, b) => b.sampledScore - a.sampledScore);

  const temperature = 0.18;
  const expScores = sampled.map((item) =>
    Math.exp(item.sampledScore / temperature),
  );
  const denominator = expScores.reduce((sum, score) => sum + score, 0);

  return sampled.slice(0, count).map((item) => {
    const index = sampled.findIndex((sample) => sample.arm === item.arm);
    return {
      ...item,
      propensity: expScores[index] / denominator,
    };
  });
}

export function posteriorAfterReward(
  posterior: Posterior,
  value: number,
): Posterior {
  const bounded = Math.max(0, Math.min(1, value));
  const alpha = posterior.alpha + bounded;
  const beta = posterior.beta + (1 - bounded);

  return {
    ...posterior,
    alpha,
    beta,
    trials: posterior.trials + 1,
    mean: alpha / (alpha + beta),
  };
}
