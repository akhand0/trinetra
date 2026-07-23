import {
  HYPOTHESIS_IDS,
  type HypothesisEvidence,
  type HypothesisId,
  type HypothesisRaceData,
} from "@/lib/telemetry/visual-response";

export const HYPOTHESIS_DEFINITIONS: ReadonlyArray<{
  id: HypothesisId;
  label: string;
  objective: string;
}> = [
  {
    id: "deploy",
    label: "Deploy",
    objective:
      "Test whether a release, configuration change, or rollout aligns with the incident and has a credible before/after effect.",
  },
  {
    id: "database",
    label: "Database",
    objective:
      "Test for query latency, connection-pool pressure, locks, saturation, or database spans that explain the incident.",
  },
  {
    id: "traffic",
    label: "Traffic",
    objective:
      "Test for request-volume, concurrency, cardinality, or route-mix changes that explain the incident.",
  },
  {
    id: "downstream",
    label: "Downstream",
    objective:
      "Test whether a dependency or downstream service contributes errors, timeouts, or critical-path latency.",
  },
];

const SCORE_BASELINE = 50;
const RESOLUTION_SCORE_MINIMUM = 65;
const RESOLUTION_MARGIN_MINIMUM = 8;

function evidenceDelta(evidence: HypothesisEvidence) {
  const magnitude = 6 + Math.round(evidence.confidence * 0.18);
  return evidence.direction === "supports" ? magnitude : -magnitude;
}

function clampScore(score: number) {
  return Math.max(4, Math.min(96, score));
}

function refreshRaceStates(
  race: HypothesisRaceData,
  forcedWinner?: HypothesisId,
): HypothesisRaceData {
  const evidenceByHypothesis = new Map<
    HypothesisId,
    HypothesisEvidence[]
  >();
  for (const id of HYPOTHESIS_IDS) evidenceByHypothesis.set(id, []);
  for (const evidence of race.evidence) {
    evidenceByHypothesis.get(evidence.hypothesisId)?.push(evidence);
  }

  const scored = race.hypotheses.map((hypothesis) => {
    const evidence = evidenceByHypothesis.get(hypothesis.id) ?? [];
    const supports = evidence.filter(
      (item) => item.direction === "supports",
    ).length;
    const contradicts = evidence.length - supports;
    const score = clampScore(
      SCORE_BASELINE +
        evidence.reduce((total, item) => total + evidenceDelta(item), 0),
    );
    return { ...hypothesis, score, supports, contradicts };
  });
  const available = scored.filter(
    (hypothesis) =>
      hypothesis.state !== "unavailable" &&
      (hypothesis.supports > 0 || hypothesis.contradicts > 0),
  );
  const leader = available.toSorted(
    (a, b) =>
      b.score - a.score ||
      b.supports - a.supports ||
      HYPOTHESIS_IDS.indexOf(a.id) - HYPOTHESIS_IDS.indexOf(b.id),
  )[0];

  return {
    ...race,
    hypotheses: scored.map((hypothesis) => {
      if (hypothesis.state === "unavailable") return hypothesis;
      if (forcedWinner) {
        return {
          ...hypothesis,
          state: hypothesis.id === forcedWinner ? "winner" : "weakened",
        };
      }
      if (race.status !== "running") {
        return {
          ...hypothesis,
          state: hypothesis.supports > 0 ? "leading" : "weakened",
        };
      }
      if (leader?.id === hypothesis.id) {
        return { ...hypothesis, state: "leading" };
      }
      if (
        hypothesis.contradicts > hypothesis.supports ||
        hypothesis.score < SCORE_BASELINE
      ) {
        return { ...hypothesis, state: "weakened" };
      }
      return { ...hypothesis, state: "testing" };
    }),
  };
}

export function createHypothesisRace(
  total = HYPOTHESIS_IDS.length,
): HypothesisRaceData {
  return {
    status: "running",
    completed: 0,
    total,
    hypotheses: HYPOTHESIS_DEFINITIONS.map(({ id, label }) => ({
      id,
      label,
      state: "testing" as const,
      score: SCORE_BASELINE,
      supports: 0,
      contradicts: 0,
    })),
    evidence: [],
  } satisfies HypothesisRaceData;
}

export function addHypothesisEvidence(
  race: HypothesisRaceData,
  evidence: HypothesisEvidence,
) {
  if (race.evidence.some((item) => item.id === evidence.id)) return race;
  return refreshRaceStates({
    ...race,
    evidence: [...race.evidence, evidence],
  });
}

export function markHypothesisUnavailable(
  race: HypothesisRaceData,
  id: HypothesisId,
  note: string,
) {
  return refreshRaceStates({
    ...race,
    hypotheses: race.hypotheses.map((hypothesis) =>
      hypothesis.id === id
        ? {
            ...hypothesis,
            state: "unavailable" as const,
            note: note.slice(0, 180),
          }
        : hypothesis,
    ),
  });
}

export function setHypothesisProgress(
  race: HypothesisRaceData,
  completed: number,
) {
  return {
    ...race,
    completed: Math.min(race.total, Math.max(0, completed)),
  };
}

export function resolveHypothesisRace(
  race: HypothesisRaceData,
): HypothesisRaceData {
  const candidates = race.hypotheses
    .filter(
      (hypothesis) =>
        hypothesis.state !== "unavailable" && hypothesis.supports > 0,
    )
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        b.supports - a.supports ||
        a.contradicts - b.contradicts ||
        HYPOTHESIS_IDS.indexOf(a.id) - HYPOTHESIS_IDS.indexOf(b.id),
    );
  const winner = candidates[0];
  const runnerUp = candidates[1];
  const isTied =
    winner &&
    runnerUp &&
    winner.score === runnerUp.score &&
    winner.supports === runnerUp.supports &&
    winner.contradicts === runnerUp.contradicts;
  const hasMeaningfulLead =
    Boolean(winner) &&
    winner.score >= RESOLUTION_SCORE_MINIMUM &&
    (!runnerUp ||
      winner.score - runnerUp.score >= RESOLUTION_MARGIN_MINIMUM);

  if (!winner || isTied || !hasMeaningfulLead) {
    return refreshRaceStates({
      ...race,
      status: "inconclusive",
      completed: race.total,
      winnerId: undefined,
    });
  }

  return refreshRaceStates(
    {
      ...race,
      status: "resolved",
      completed: race.total,
      winnerId: winner.id,
    },
    winner.id,
  );
}

export function hypothesisIdFromText(value: string): HypothesisId | null {
  const normalized = value.toLowerCase();
  const candidates: Array<{ id: HypothesisId; index: number }> = [
    {
      id: "deploy",
      index: normalized.search(
        /\b(deploy(?:ment)?|rollout|release|version|configuration change)\b/,
      ),
    },
    {
      id: "database",
      index: normalized.search(
        /\b(database|db pool|connection pool|sql|query latency|lock contention)\b/,
      ),
    },
    {
      id: "traffic",
      index: normalized.search(
        /\b(traffic|request volume|request rate|rps|load surge|cardinality)\b/,
      ),
    },
    {
      id: "downstream",
      index: normalized.search(
        /\b(downstream|upstream|dependency|external service|remote service)\b/,
      ),
    },
  ];
  const matches = candidates.filter((match) => match.index >= 0);
  return matches.toSorted((a, b) => a.index - b.index)[0]?.id ?? null;
}

export function reconcileHypothesisRace(
  race: HypothesisRaceData,
  visualVerdict: string,
) {
  if (race.status !== "resolved" || !race.winnerId) return race;
  const visualCause = hypothesisIdFromText(visualVerdict);
  if (!visualCause || visualCause === race.winnerId) return race;
  return refreshRaceStates({
    ...race,
    status: "inconclusive",
    winnerId: undefined,
  });
}
