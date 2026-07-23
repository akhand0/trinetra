import { describe, expect, it } from "vitest";
import {
  SHARE_TOKEN_PATTERN,
  SharedVisualResponseInputError,
  createShareToken,
  hashShareToken,
  prepareSharedVisualResponse,
  readSharedVisualResponse,
} from "@/lib/clickhouse/shared-visual-responses";

const completedResponse = {
  id: "share-test-response",
  query: "Why was checkout slow?",
  title: "Checkout latency investigation",
  verdict: "Payment latency is the dominant signal.",
  status: "complete" as const,
  specialists: ["Latency"],
  panels: [
    {
      id: "latency",
      kind: "metrics" as const,
      level: "overview" as const,
      span: "full" as const,
      title: "Latency verdict",
      eyebrow: "Overview",
      finding: "Payment p99 increased after deployment.",
      metrics: {
        title: "Latency",
        items: [{ label: "p99", value: "2.4 s", tone: "bad" as const }],
      },
    },
  ],
};

describe("shared visual responses", () => {
  it("creates a 256-bit URL-safe token and stores only its deterministic hash", () => {
    const token = createShareToken();
    const hash = hashShareToken(token);

    expect(token).toHaveLength(43);
    expect(SHARE_TOKEN_PATTERN.test(token)).toBe(true);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashShareToken(token));
    expect(hash).not.toContain(token);
  });

  it("revalidates and strips unknown client properties", () => {
    const prepared = prepareSharedVisualResponse({
      ...completedResponse,
      injected: "not persisted",
    });

    expect(prepared.response).toEqual(completedResponse);
    expect(prepared.json).not.toContain("injected");
  });

  it("rejects running, empty, and oversized responses", () => {
    expect(() =>
      prepareSharedVisualResponse({
        ...completedResponse,
        status: "running",
      }),
    ).toThrow(SharedVisualResponseInputError);
    expect(() =>
      prepareSharedVisualResponse({
        ...completedResponse,
        panels: [],
      }),
    ).toThrow(SharedVisualResponseInputError);

    expect(() =>
      prepareSharedVisualResponse({
        ...completedResponse,
        panels: [
          {
            id: "oversized",
            kind: "table",
            level: "evidence",
            span: "full",
            title: "Oversized evidence",
            eyebrow: "Evidence",
            finding: "A deliberately oversized cell.",
            table: {
              title: "Payload",
              columns: [{ key: "payload", label: "Payload" }],
              rows: [{ payload: "x".repeat(520 * 1024) }],
            },
          },
        ],
      }),
    ).toThrow("too large");
  });

  it("rejects malformed bearer tokens before storage lookup", async () => {
    await expect(readSharedVisualResponse("not-a-token")).resolves.toBeNull();
  });
});
