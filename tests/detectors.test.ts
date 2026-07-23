import { describe, expect, it } from "vitest";
import {
  evaluateErrorRateSpike,
  evaluateLatencyRegression,
  evaluateTelemetryFreshness,
  nextDetectionRun,
} from "@/lib/telemetry/detectors";

const evaluatedAt = new Date("2026-07-23T12:05:00.000Z");
const context = {
  evaluatedAt,
  windowStart: new Date("2026-07-23T11:30:00.000Z"),
  windowEnd: new Date("2026-07-23T12:00:00.000Z"),
  matchedSeries: 7,
};

describe("always-on detector evaluations", () => {
  it("fires a critical latency incident only for a material p99 regression", () => {
    const firing = evaluateLatencyRegression(
      {
        service: "checkout",
        currentP99Ms: 1_250,
        baselineP99Ms: 310,
        currentCount: 400,
        baselineCount: 2_400,
      },
      context,
    );
    const lowLatencyRatio = evaluateLatencyRegression(
      {
        service: "cart",
        currentP99Ms: 6,
        baselineP99Ms: 2,
        currentCount: 100,
        baselineCount: 600,
      },
      context,
    );

    expect(firing.status).toBe("triggered");
    expect(firing.severity).toBe("critical");
    expect(firing.threshold).toBe(558);
    expect(lowLatencyRatio.status).toBe("healthy");
  });

  it("requires both a breached error-rate guardrail and enough errors", () => {
    const firing = evaluateErrorRateSpike(
      {
        service: "payments",
        currentRate: 0.18,
        baselineRate: 0.02,
        currentErrors: 18,
        currentCount: 100,
        baselineCount: 600,
      },
      context,
    );
    const sparse = evaluateErrorRateSpike(
      {
        service: "frontend",
        currentRate: 0.2,
        baselineRate: 0.01,
        currentErrors: 2,
        currentCount: 10,
        baselineCount: 600,
      },
      context,
    );

    expect(firing.status).toBe("triggered");
    expect(firing.observed).toBe(18);
    expect(firing.threshold).toBe(4);
    expect(sparse.status).toBe("healthy");
  });

  it("opens a freshness signal when telemetry is more than ten minutes old", () => {
    const fresh = evaluateTelemetryFreshness(
      new Date("2026-07-23T12:01:00.000Z"),
      context,
    );
    const stale = evaluateTelemetryFreshness(
      new Date("2026-07-23T10:00:00.000Z"),
      context,
    );

    expect(fresh.status).toBe("healthy");
    expect(stale.status).toBe("triggered");
    expect(stale.severity).toBe("high");
  });

  it("calculates the next five-minute UTC boundary", () => {
    expect(
      nextDetectionRun(new Date("2026-07-23T12:02:48.000Z")).toISOString(),
    ).toBe("2026-07-23T12:05:00.000Z");
    expect(
      nextDetectionRun(new Date("2026-07-23T12:05:00.000Z")).toISOString(),
    ).toBe("2026-07-23T12:10:00.000Z");
  });
});
