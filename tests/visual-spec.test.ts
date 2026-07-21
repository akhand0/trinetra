import { describe, expect, it } from "vitest";
import {
  safeParseMetricSpec,
  safeParseTableSpec,
} from "@/lib/telemetry/chart-spec";

describe("visual response contracts", () => {
  it("accepts a searchable table payload", () => {
    const spec = safeParseTableSpec({
      title: "ClickHouse tables",
      columns: [
        { key: "name", label: "Table" },
        { key: "engine", label: "Engine" },
      ],
      rows: [{ name: "otel_logs", engine: "SharedMergeTree" }],
      defaultSort: { key: "name", direction: "asc" },
    });

    expect(spec?.rows[0].name).toBe("otel_logs");
  });

  it("rejects unbounded or empty table payloads", () => {
    expect(
      safeParseTableSpec({ title: "Empty", columns: [], rows: [] }),
    ).toBeNull();
  });

  it("defaults metric tones to neutral", () => {
    const spec = safeParseMetricSpec({
      title: "Service health",
      items: [{ label: "Error rate", value: "0.4%" }],
    });

    expect(spec?.items[0].tone).toBe("neutral");
  });
});
