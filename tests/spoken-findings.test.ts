import { describe, expect, it } from "vitest";
import {
  SPOKEN_FINDINGS_LIMIT,
  spokenFindingsFromParts,
} from "@/lib/telemetry/spoken-findings";

describe("spoken findings", () => {
  it("reads the verdict and each validated panel finding", () => {
    const speech = spokenFindingsFromParts([
      {
        type: "text",
        text: "A long prose preface that should not displace the visual findings.",
      },
      {
        type: "data-visual-response",
        data: {
          id: "response-1",
          query: "Why was checkout slow?",
          title: "Checkout investigation",
          verdict: "Payment latency is the dominant signal.",
          status: "complete",
          specialists: ["Latency", "Trace"],
          panels: [
            {
              id: "latency",
              kind: "metrics",
              level: "overview",
              span: "half",
              title: "Latency verdict",
              eyebrow: "Overview",
              finding: "Payment p99 increased after deployment.",
              metrics: {
                title: "Latency",
                items: [
                  { label: "p99", value: "2.4 s", tone: "bad" },
                ],
              },
            },
            {
              id: "trace",
              kind: "table",
              level: "evidence",
              span: "half",
              title: "Trace evidence",
              eyebrow: "Evidence",
              finding: "Slow traces converge on payment-api.",
              table: {
                title: "Traces",
                columns: [{ key: "service", label: "Service" }],
                rows: [{ service: "payment-api" }],
              },
            },
          ],
        },
      },
    ]);

    expect(speech).toContain("Payment latency is the dominant signal.");
    expect(speech).toContain(
      "Latency verdict. Payment p99 increased after deployment.",
    );
    expect(speech).toContain(
      "Trace evidence. Slow traces converge on payment-api.",
    );
    expect(speech).not.toContain("long prose preface");
  });

  it("cleans markdown and keeps speech bounded at a word boundary", () => {
    const speech = spokenFindingsFromParts([
      {
        type: "text",
        text: `**Finding:** [payment-api](https://example.com) ${"slow ".repeat(
          400,
        )}`,
      },
    ]);

    expect(speech).not.toContain("https://");
    expect(speech).not.toContain("**");
    expect(speech.length).toBeLessThanOrEqual(SPOKEN_FINDINGS_LIMIT);
    expect(speech.endsWith(".")).toBe(true);
  });
});
