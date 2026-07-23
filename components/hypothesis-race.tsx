"use client";

import {
  Activity,
  Check,
  CircleDashed,
  Database,
  GitBranch,
  Network,
  Rocket,
  ShieldQuestion,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type {
  HypothesisId,
  HypothesisRaceData,
} from "@/lib/telemetry/visual-response";

const hypothesisIcons = {
  deploy: Rocket,
  database: Database,
  traffic: Activity,
  downstream: Network,
} satisfies Record<HypothesisId, typeof Rocket>;

function stateLabel(
  state: HypothesisRaceData["hypotheses"][number]["state"],
) {
  if (state === "winner") return "Best supported";
  if (state === "leading") return "Leading";
  if (state === "weakened") return "Weakened";
  if (state === "unavailable") return "No signal";
  return "Testing";
}

export function HypothesisRace({ race }: { race: HypothesisRaceData }) {
  const titleId = useId();
  const descriptionPrefix = useId();
  const automaticSelection =
    race.winnerId ??
    race.hypotheses.find((hypothesis) => hypothesis.state === "leading")?.id ??
    race.hypotheses[0].id;
  const [manualSelection, setManualSelection] =
    useState<HypothesisId | null>(null);
  const selectedId = manualSelection ?? automaticSelection;
  const [liveMessage, setLiveMessage] = useState("");
  const seenEvidenceRef = useRef<Set<string> | null>(null);
  const previousStatusRef = useRef(race.status);

  useEffect(() => {
    const evidenceIds = new Set(race.evidence.map((evidence) => evidence.id));
    if (!seenEvidenceRef.current) {
      seenEvidenceRef.current = evidenceIds;
      return;
    }
    const arrival = race.evidence.find(
      (evidence) => !seenEvidenceRef.current?.has(evidence.id),
    );
    seenEvidenceRef.current = evidenceIds;
    if (arrival) {
      const hypothesis = race.hypotheses.find(
        (candidate) => candidate.id === arrival.hypothesisId,
      );
      setLiveMessage(
        `${arrival.direction === "supports" ? "Supporting" : "Contradicting"} evidence arrived for ${hypothesis?.label ?? arrival.hypothesisId}.`,
      );
    }
  }, [race.evidence, race.hypotheses]);

  useEffect(() => {
    if (
      previousStatusRef.current === "running" &&
      race.status === "resolved" &&
      race.winnerId
    ) {
      const winner = race.hypotheses.find(
        (hypothesis) => hypothesis.id === race.winnerId,
      );
      setLiveMessage(
        `${winner?.label ?? race.winnerId} is the best-supported cause.`,
      );
    }
    previousStatusRef.current = race.status;
  }, [race.hypotheses, race.status, race.winnerId]);

  const selected =
    race.hypotheses.find((hypothesis) => hypothesis.id === selectedId) ??
    race.hypotheses[0];
  const selectedEvidence = race.evidence
    .filter((evidence) => evidence.hypothesisId === selected.id)
    .toReversed();
  const latestEvidence = race.evidence.at(-1);
  const latestHypothesis = latestEvidence
    ? race.hypotheses.find(
        (hypothesis) => hypothesis.id === latestEvidence.hypothesisId,
      )
    : undefined;
  const winner = race.winnerId
    ? race.hypotheses.find(
        (hypothesis) => hypothesis.id === race.winnerId,
      )
    : undefined;

  return (
    <section
      className={`hypothesis-race status-${race.status}`}
      aria-labelledby={titleId}
    >
      <header className="hypothesis-race-header">
        <div>
          <span>
            <GitBranch size={13} />
            Live hypothesis race
          </span>
          <strong id={titleId}>
            {race.status === "resolved"
              ? `${winner?.label ?? "One cause"} is best supported`
              : race.status === "inconclusive"
                ? "Evidence remains split"
                : "Four causes. One evidence trail."}
          </strong>
        </div>
        <div className="hypothesis-race-progress">
          {race.status === "running" ? (
            <>
              <CircleDashed size={13} />
              {race.completed}/{race.total} tested
            </>
          ) : race.status === "resolved" ? (
            <>
              <Check size={13} />
              Resolved
            </>
          ) : (
            <>
              <ShieldQuestion size={13} />
              Inconclusive
            </>
          )}
        </div>
      </header>

      <ol className="hypothesis-race-nodes">
        {race.hypotheses.map((hypothesis) => {
          const Icon = hypothesisIcons[hypothesis.id];
          const descriptionId = `${descriptionPrefix}-${hypothesis.id}-description`;
          return (
            <li
              key={hypothesis.id}
              className={`state-${hypothesis.state}${
                selected.id === hypothesis.id ? " selected" : ""
              }`}
            >
              <button
                type="button"
                aria-pressed={selected.id === hypothesis.id}
                aria-describedby={descriptionId}
                onClick={() => {
                  setManualSelection(hypothesis.id);
                }}
              >
                <span className="hypothesis-node-topline">
                  <i aria-hidden="true">
                    <Icon size={15} />
                  </i>
                  <small>{stateLabel(hypothesis.state)}</small>
                </span>
                <strong>{hypothesis.label}</strong>
                <span className="hypothesis-node-score">
                  <meter
                    min={0}
                    max={100}
                    value={hypothesis.score}
                    aria-label={`${hypothesis.label} evidence score ${hypothesis.score} out of 100`}
                  />
                  <b>{hypothesis.score}</b>
                </span>
                <span
                  id={descriptionId}
                  className="hypothesis-node-counts"
                >
                  <em>
                    <ThumbsUp size={11} /> {hypothesis.supports}
                  </em>
                  <em>
                    <ThumbsDown size={11} /> {hypothesis.contradicts}
                  </em>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="hypothesis-race-evidence">
        <div className="hypothesis-evidence-focus">
          <span>
            Inspecting <b>{selected.label}</b>
          </span>
          <small>
            {selectedEvidence.length > 0
              ? `${selectedEvidence.length} evidence ${selectedEvidence.length === 1 ? "signal" : "signals"}`
              : selected.note ?? "Waiting for a verified signal…"}
          </small>
        </div>
        <div className="hypothesis-evidence-list">
          {selectedEvidence.slice(0, 2).map((evidence) => (
            <div className={evidence.direction} key={evidence.id}>
              <i aria-hidden="true">
                {evidence.direction === "supports" ? (
                  <ThumbsUp size={13} />
                ) : (
                  <ThumbsDown size={13} />
                )}
              </i>
              <span>
                <b className="hypothesis-evidence-observation">
                  {evidence.observed}
                </b>
                {evidence.summary}
                <small>
                  {evidence.baseline
                    ? `Baseline ${evidence.baseline} · `
                    : ""}
                  {evidence.source}
                  {evidence.window ? ` · ${evidence.window}` : ""} ·{" "}
                  {evidence.confidence}% confidence
                </small>
              </span>
            </div>
          ))}
          {selectedEvidence.length === 0 && (
            <div className="pending">
              <i aria-hidden="true">
                <CircleDashed size={13} />
              </i>
              <span>
                {selected.state === "unavailable"
                  ? "This cause could not be tested with the available telemetry."
                  : "The investigator is comparing this cause with the incident window."}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="hypothesis-race-ticker" aria-hidden="true">
        <span>Latest evidence</span>
        <b>
          {latestEvidence
            ? `${latestHypothesis?.label ?? latestEvidence.hypothesisId}: ${latestEvidence.summary}`
            : "Investigators are querying ClickHouse…"}
        </b>
      </div>
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveMessage}
      </span>
    </section>
  );
}
