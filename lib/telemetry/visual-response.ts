import { z } from "zod";
import {
  chartSpecSchema,
  metricSpecSchema,
  tableSpecSchema,
} from "@/lib/telemetry/chart-spec";

export const VISUAL_LEVELS = ["overview", "analysis", "evidence"] as const;
export const VISUAL_SPANS = ["full", "half"] as const;

const panelBaseSchema = z.object({
  id: z.string().min(1).max(100),
  level: z.enum(VISUAL_LEVELS),
  span: z.enum(VISUAL_SPANS),
  title: z.string().min(1).max(120),
  eyebrow: z.string().min(1).max(64),
  finding: z.string().min(1).max(180),
  source: z.string().max(100).optional(),
});

export const visualPanelSchema = z.discriminatedUnion("kind", [
  panelBaseSchema.extend({ kind: z.literal("metrics"), metrics: metricSpecSchema }),
  panelBaseSchema.extend({ kind: z.literal("chart"), spec: chartSpecSchema }),
  panelBaseSchema.extend({ kind: z.literal("table"), table: tableSpecSchema }),
]);

export const visualResponseSchema = z.object({
  id: z.string().min(1).max(100),
  query: z.string().min(1).max(2000).optional(),
  title: z.string().min(1).max(140),
  verdict: z.string().min(1).max(240),
  status: z.enum(["running", "complete"]),
  specialists: z.array(z.string().min(1).max(64)).max(5).default([]),
  panels: z.array(visualPanelSchema).max(6),
});

export const chartSubmissionSchema = z.object({
  title: z.string().min(1).max(120),
  finding: z.string().min(1).max(180),
  source: z.string().max(100).optional(),
  spec: chartSpecSchema,
});

export const metricSubmissionSchema = z.object({
  title: z.string().min(1).max(120),
  finding: z.string().min(1).max(180),
  source: z.string().max(100).optional(),
  metrics: metricSpecSchema,
});

export const tableSubmissionSchema = z.object({
  title: z.string().min(1).max(120),
  finding: z.string().min(1).max(180),
  source: z.string().max(100).optional(),
  table: tableSpecSchema,
});

export const unavailableSubmissionSchema = z.object({
  reason: z.string().min(1).max(180),
});

export const visualSubmissionSchema = z.discriminatedUnion("kind", [
  metricSubmissionSchema.extend({ kind: z.literal("metrics") }),
  chartSubmissionSchema.extend({ kind: z.literal("chart") }),
  tableSubmissionSchema.extend({ kind: z.literal("table") }),
  unavailableSubmissionSchema.extend({ kind: z.literal("unavailable") }),
]);

export type VisualPanel = z.infer<typeof visualPanelSchema>;
export type VisualResponseData = z.infer<typeof visualResponseSchema>;
export type ChartSubmission = z.infer<typeof chartSubmissionSchema>;
export type MetricSubmission = z.infer<typeof metricSubmissionSchema>;
export type TableSubmission = z.infer<typeof tableSubmissionSchema>;
export type VisualSubmission = z.infer<typeof visualSubmissionSchema>;

export function safeParseVisualResponse(
  input: unknown,
): VisualResponseData | null {
  const result = visualResponseSchema.safeParse(input);
  return result.success ? result.data : null;
}
