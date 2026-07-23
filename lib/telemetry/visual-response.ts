import { z } from "zod";
import {
  chartSpecSchema,
  heatmapSpecSchema,
  metricSpecSchema,
  tableSpecSchema,
  traceSpecSchema,
} from "@/lib/telemetry/chart-spec";

export const VISUAL_LEVELS = ["overview", "analysis", "evidence"] as const;
export const VISUAL_SPANS = ["full", "half"] as const;
export const MAX_INVESTIGATION_VISUALS = 8;
export const HYPOTHESIS_IDS = [
  "deploy",
  "database",
  "traffic",
  "downstream",
] as const;

export const hypothesisIdSchema = z.enum(HYPOTHESIS_IDS);

export const hypothesisEvaluationSchema = z.object({
  id: hypothesisIdSchema,
  direction: z.enum(["supports", "contradicts"]),
  rationale: z.string().min(1).max(180),
  confidence: z.number().int().min(0).max(100),
  source: z.string().min(1).max(100),
  observed: z.string().min(1).max(100),
  baseline: z.string().min(1).max(100).optional(),
  window: z.string().min(1).max(100).optional(),
});

export const hypothesisEvidenceSchema = z.object({
  id: z.string().min(1).max(100),
  hypothesisId: hypothesisIdSchema,
  direction: z.enum(["supports", "contradicts"]),
  summary: z.string().min(1).max(180),
  confidence: z.number().int().min(0).max(100),
  source: z.string().min(1).max(100),
  observed: z.string().min(1).max(100),
  baseline: z.string().min(1).max(100).optional(),
  window: z.string().min(1).max(100).optional(),
  panelId: z.string().min(1).max(100).optional(),
});

export const hypothesisNodeSchema = z.object({
  id: hypothesisIdSchema,
  label: z.string().min(1).max(48),
  state: z.enum([
    "testing",
    "leading",
    "weakened",
    "winner",
    "unavailable",
  ]),
  score: z.number().int().min(0).max(100),
  supports: z.number().int().min(0),
  contradicts: z.number().int().min(0),
  note: z.string().min(1).max(180).optional(),
});

export const hypothesisRaceSchema = z
  .object({
    status: z.enum(["running", "resolved", "inconclusive"]),
    completed: z.number().int().min(0).max(MAX_INVESTIGATION_VISUALS),
    total: z.number().int().min(1).max(MAX_INVESTIGATION_VISUALS),
    winnerId: hypothesisIdSchema.optional(),
    hypotheses: z.array(hypothesisNodeSchema).length(HYPOTHESIS_IDS.length),
    evidence: z.array(hypothesisEvidenceSchema).max(40),
  })
  .superRefine((race, context) => {
    const ids = new Set(race.hypotheses.map((hypothesis) => hypothesis.id));
    if (
      ids.size !== HYPOTHESIS_IDS.length ||
      HYPOTHESIS_IDS.some((id) => !ids.has(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["hypotheses"],
        message: "The race must contain each competing hypothesis exactly once.",
      });
    }
    if (race.completed > race.total) {
      context.addIssue({
        code: "custom",
        path: ["completed"],
        message: "Completed investigators cannot exceed the team size.",
      });
    }
    const winners = race.hypotheses.filter(
      (hypothesis) => hypothesis.state === "winner",
    );
    if (
      race.status === "resolved" &&
      (!race.winnerId ||
        winners.length !== 1 ||
        winners[0]?.id !== race.winnerId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["winnerId"],
        message: "A resolved race must identify exactly one winning hypothesis.",
      });
    }
    if (race.status !== "resolved" && (race.winnerId || winners.length > 0)) {
      context.addIssue({
        code: "custom",
        path: ["winnerId"],
        message: "Only a resolved race can have a winner.",
      });
    }
  });

const panelBaseSchema = z.object({
  id: z.string().min(1).max(100),
  level: z.enum(VISUAL_LEVELS),
  span: z.enum(VISUAL_SPANS),
  title: z.string().min(1).max(160),
  eyebrow: z.string().min(1).max(64),
  finding: z.string().min(1).max(300),
  source: z.string().max(100).optional(),
});

export const visualPanelSchema = z.discriminatedUnion("kind", [
  panelBaseSchema.extend({ kind: z.literal("metrics"), metrics: metricSpecSchema }),
  panelBaseSchema.extend({ kind: z.literal("chart"), spec: chartSpecSchema }),
  panelBaseSchema.extend({ kind: z.literal("table"), table: tableSpecSchema }),
  panelBaseSchema.extend({
    kind: z.literal("heatmap"),
    heatmap: heatmapSpecSchema,
  }),
  panelBaseSchema.extend({ kind: z.literal("trace"), trace: traceSpecSchema }),
]);

export const visualResponseSchema = z.object({
  id: z.string().min(1).max(100),
  query: z.string().min(1).max(2000).optional(),
  title: z.string().min(1).max(140),
  verdict: z.string().min(1).max(360),
  status: z.enum(["running", "complete"]),
  specialists: z
    .array(z.string().min(1).max(64))
    .max(MAX_INVESTIGATION_VISUALS)
    .default([]),
  hypothesisRace: hypothesisRaceSchema.optional(),
  panels: z.array(visualPanelSchema).max(MAX_INVESTIGATION_VISUALS),
});

export const chartSubmissionSchema = z.object({
  finding: z.string().min(1).max(300),
  source: z.string().max(100).optional(),
  spec: chartSpecSchema,
});

export const metricSubmissionSchema = z.object({
  finding: z.string().min(1).max(300),
  source: z.string().max(100).optional(),
  metrics: metricSpecSchema,
});

export const tableSubmissionSchema = z.object({
  finding: z.string().min(1).max(300),
  source: z.string().max(100).optional(),
  table: tableSpecSchema,
});

export const heatmapSubmissionSchema = z.object({
  finding: z.string().min(1).max(300),
  source: z.string().max(100).optional(),
  heatmap: heatmapSpecSchema,
});

export const traceSubmissionSchema = z.object({
  finding: z.string().min(1).max(300),
  source: z.string().max(100).optional(),
  trace: traceSpecSchema,
});

export const unavailableSubmissionSchema = z.object({
  reason: z.string().min(1).max(300),
});

export const visualSubmissionSchema = z.discriminatedUnion("kind", [
  metricSubmissionSchema.extend({ kind: z.literal("metrics") }),
  chartSubmissionSchema.extend({ kind: z.literal("chart") }),
  tableSubmissionSchema.extend({ kind: z.literal("table") }),
  heatmapSubmissionSchema.extend({ kind: z.literal("heatmap") }),
  traceSubmissionSchema.extend({ kind: z.literal("trace") }),
  unavailableSubmissionSchema.extend({ kind: z.literal("unavailable") }),
]);

export type VisualPanel = z.infer<typeof visualPanelSchema>;
export type VisualResponseData = z.infer<typeof visualResponseSchema>;
export type HypothesisId = z.infer<typeof hypothesisIdSchema>;
export type HypothesisEvaluation = z.infer<typeof hypothesisEvaluationSchema>;
export type HypothesisEvidence = z.infer<typeof hypothesisEvidenceSchema>;
export type HypothesisRaceData = z.infer<typeof hypothesisRaceSchema>;
export type ChartSubmission = z.infer<typeof chartSubmissionSchema>;
export type MetricSubmission = z.infer<typeof metricSubmissionSchema>;
export type TableSubmission = z.infer<typeof tableSubmissionSchema>;
export type HeatmapSubmission = z.infer<typeof heatmapSubmissionSchema>;
export type TraceSubmission = z.infer<typeof traceSubmissionSchema>;
export type VisualSubmission = z.infer<typeof visualSubmissionSchema>;

export function safeParseVisualResponse(
  input: unknown,
): VisualResponseData | null {
  const result = visualResponseSchema.safeParse(input);
  return result.success ? result.data : null;
}
