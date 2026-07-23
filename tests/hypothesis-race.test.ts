import { describe, expect, it } from "vitest";
import {
  addHypothesisEvidence,
  createHypothesisRace,
  markHypothesisUnavailable,
  reconcileHypothesisRace,
  resolveHypothesisRace,
  setHypothesisProgress,
} from "@/lib/telemetry/hypothesis-race";
import {
  HYPOTHESIS_IDS,
  hypothesisRaceSchema,
  safeParseVisualResponse,
} from "@/lib/telemetry/visual-response";

describe("live hypothesis race", () => {
  it("starts with four fixed, neutral causes", () => {
    const race = createHypothesisRace();

    expect(race.status).toBe("running");
    expect(race.hypotheses.map((hypothesis) => hypothesis.id)).toEqual(
      HYPOTHESIS_IDS,
    );
    expect(race.hypotheses.every((hypothesis) => hypothesis.score === 50)).toBe(
      true,
    );
  });

  it("moves support and contradiction evidence through the race", () => {
    let race = createHypothesisRace();
    race = addHypothesisEvidence(race, {
      id: "database-signal",
      hypothesisId: "database",
      direction: "supports",
      summary: "Pool wait time rose in the incident window.",
      confidence: 92,
      source: "otel_traces",
      observed: "840ms pool wait",
      baseline: "42ms pool wait",
    });
    race = addHypothesisEvidence(race, {
      id: "traffic-signal",
      hypothesisId: "traffic",
      direction: "contradicts",
      summary: "Request volume remained inside the baseline band.",
      confidence: 81,
      source: "otel_metrics",
      observed: "1.02× baseline request rate",
      baseline: "980 requests/min",
    });
    race = setHypothesisProgress(race, 2);

    expect(race.completed).toBe(2);
    expect(
      race.hypotheses.find((hypothesis) => hypothesis.id === "database"),
    ).toMatchObject({ state: "leading", supports: 1 });
    expect(
      race.hypotheses.find((hypothesis) => hypothesis.id === "traffic"),
    ).toMatchObject({ state: "weakened", contradicts: 1 });
  });

  it("resolves one evidence-backed winner and preserves unavailable causes", () => {
    let race = createHypothesisRace();
    race = addHypothesisEvidence(race, {
      id: "deploy-signal",
      hypothesisId: "deploy",
      direction: "contradicts",
      summary: "The rollout followed the first latency increase.",
      confidence: 70,
      source: "logs",
      observed: "rollout followed latency rise",
    });
    race = addHypothesisEvidence(race, {
      id: "database-signal",
      hypothesisId: "database",
      direction: "supports",
      summary: "Database pool waits explain the critical-path delay.",
      confidence: 94,
      source: "otel_traces",
      observed: "840ms pool wait on critical path",
      baseline: "42ms pool wait",
    });
    race = markHypothesisUnavailable(
      race,
      "downstream",
      "Dependency spans were not retained.",
    );
    race = resolveHypothesisRace(race);

    expect(race.status).toBe("resolved");
    expect(race.winnerId).toBe("database");
    expect(
      race.hypotheses.filter((hypothesis) => hypothesis.state === "winner"),
    ).toHaveLength(1);
    expect(
      race.hypotheses.find((hypothesis) => hypothesis.id === "downstream"),
    ).toMatchObject({ state: "unavailable" });
    expect(hypothesisRaceSchema.safeParse(race).success).toBe(true);
  });

  it("does not manufacture a winner when support is tied", () => {
    let race = createHypothesisRace();
    for (const id of ["deploy", "database"] as const) {
      race = addHypothesisEvidence(race, {
        id: `${id}-signal`,
        hypothesisId: id,
        direction: "supports",
        summary: `${id} has one equally strong signal.`,
        confidence: 80,
        source: "telemetry",
        observed: "one equally strong signal",
      });
    }

    race = resolveHypothesisRace(race);

    expect(race.status).toBe("inconclusive");
    expect(race.winnerId).toBeUndefined();
  });

  it("falls back to inconclusive when the visual verdict disagrees", () => {
    let race = createHypothesisRace();
    race = addHypothesisEvidence(race, {
      id: "database-signal",
      hypothesisId: "database",
      direction: "supports",
      summary: "Pool waits rose on the critical path.",
      confidence: 94,
      source: "otel_traces",
      observed: "840ms pool wait",
      baseline: "42ms pool wait",
    });

    race = reconcileHypothesisRace(
      resolveHypothesisRace(race),
      "The deployment rollout is the strongest causal signal.",
    );

    expect(race.status).toBe("inconclusive");
    expect(race.winnerId).toBeUndefined();
  });

  it("keeps older visual responses backward compatible", () => {
    expect(
      safeParseVisualResponse({
        id: "legacy-response",
        title: "Legacy investigation",
        verdict: "Existing shared reports still render.",
        status: "complete",
        specialists: [],
        panels: [],
      })?.hypothesisRace,
    ).toBeUndefined();
  });
});
