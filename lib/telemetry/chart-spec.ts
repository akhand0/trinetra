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

/** Validates untrusted input; returns null instead of throwing so a bad spec
 * degrades to an empty state rather than crashing the turn. */
export function safeParseChartSpec(input: unknown): ChartSpec | null {
  const result = chartSpecSchema.safeParse(input);
  return result.success ? result.data : null;
}
