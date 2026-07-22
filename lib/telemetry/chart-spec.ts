import { z } from "zod";

/**
 * A deliberately small, Vega-Lite-flavored chart grammar. The agent composes a
 * visualization by choosing a mark and encoding channels over a flat data
 * table it has already queried — it never ships arbitrary render payloads.
 * Everything is validated before it reaches the client.
 */
export const CHART_MARKS = ["line", "area", "bar", "scatter"] as const;
export type ChartMark = (typeof CHART_MARKS)[number];

const channelSchema = z.object({
  field: z.string().min(1).max(64),
  label: z.string().max(64).optional(),
});

export const chartSpecSchema = z.object({
  mark: z.enum(CHART_MARKS),
  title: z.string().max(120).optional(),
  x: channelSchema,
  y: channelSchema,
  /** Optional grouping channel — splits the data into colored series. */
  series: z.object({ field: z.string().min(1).max(64) }).optional(),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(1)
    .max(200),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const visualCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const tableSpecSchema = z.object({
  title: z.string().min(1).max(120),
  columns: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        label: z.string().min(1).max(64),
      }),
    )
    .min(1)
    .max(10),
  rows: z
    .array(z.record(z.string(), visualCellSchema))
    .min(1)
    .max(200),
  defaultSort: z
    .object({
      key: z.string().min(1).max(64),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  searchPlaceholder: z.string().max(80).optional(),
});

export type TableSpec = z.infer<typeof tableSpecSchema>;

export const metricSpecSchema = z.object({
  title: z.string().min(1).max(120),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(64),
        value: z.string().min(1).max(64),
        detail: z.string().max(120).optional(),
        trend: z.string().max(32).optional(),
        tone: z.enum(["good", "warning", "bad", "neutral"]).default("neutral"),
      }),
    )
    .min(1)
    .max(8),
});

export type MetricSpec = z.infer<typeof metricSpecSchema>;

export const heatmapSpecSchema = z.object({
  title: z.string().min(1).max(120),
  rowLabel: z.string().max(64).optional(),
  columnLabel: z.string().max(64).optional(),
  valueLabel: z.string().max(64).optional(),
  cells: z
    .array(
      z.object({
        row: z.string().min(1).max(64),
        column: z.string().min(1).max(64),
        value: z.number().finite(),
      }),
    )
    .min(2)
    .max(160),
});

export type HeatmapSpec = z.infer<typeof heatmapSpecSchema>;

export const traceSpecSchema = z.object({
  title: z.string().min(1).max(120),
  traceId: z.string().max(64).optional(),
  totalDurationMs: z.number().finite().positive(),
  spans: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        parentId: z.string().max(64).optional(),
        service: z.string().min(1).max(64),
        operation: z.string().min(1).max(96),
        startMs: z.number().finite().nonnegative(),
        durationMs: z.number().finite().nonnegative(),
        status: z.enum(["ok", "error"]).default("ok"),
      }),
    )
    .min(1)
    .max(80),
});

export type TraceSpec = z.infer<typeof traceSpecSchema>;

/** Validates untrusted input; returns null instead of throwing so a bad spec
 * degrades to an empty state rather than crashing the turn. */
export function safeParseChartSpec(input: unknown): ChartSpec | null {
  const result = chartSpecSchema.safeParse(input);
  return result.success ? result.data : null;
}

export function safeParseTableSpec(input: unknown): TableSpec | null {
  const result = tableSpecSchema.safeParse(input);
  return result.success ? result.data : null;
}

export function safeParseMetricSpec(input: unknown): MetricSpec | null {
  const result = metricSpecSchema.safeParse(input);
  return result.success ? result.data : null;
}

export function safeParseHeatmapSpec(input: unknown): HeatmapSpec | null {
  const result = heatmapSpecSchema.safeParse(input);
  return result.success ? result.data : null;
}

export function safeParseTraceSpec(input: unknown): TraceSpec | null {
  const result = traceSpecSchema.safeParse(input);
  return result.success ? result.data : null;
}
