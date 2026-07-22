import { z } from "zod";
import type { VisualPanel } from "@/lib/telemetry/visual-response";

export const INVESTIGATION_ACTIONS = [
  "explain",
  "compare",
  "find_evidence",
] as const;

export const SELECTION_SEMANTICS = [
  "time",
  "service",
  "trace_id",
  "span_id",
  "status",
  "operation",
  "region",
  "environment",
  "version",
  "category",
] as const;

const selectionScalarSchema = z.union([
  z.string().max(240),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const selectionFacetSchema = z.object({
  field: z.string().min(1).max(64),
  label: z.string().min(1).max(64).optional(),
  value: selectionScalarSchema,
  semantic: z.enum(SELECTION_SEMANTICS),
});

export const selectionMeasureSchema = z.object({
  field: z.string().min(1).max(64),
  label: z.string().min(1).max(64).optional(),
  value: z.number().finite(),
});

export const investigationSelectionSchema = z.object({
  version: z.literal(1),
  responseId: z.string().min(1).max(100),
  panelId: z.string().min(1).max(100),
  panelTitle: z.string().min(1).max(160),
  visualKind: z.enum(["chart", "table", "metrics", "heatmap", "trace"]),
  markId: z.string().min(1).max(180),
  label: z.string().min(1).max(240),
  facets: z.array(selectionFacetSchema).max(10),
  measures: z.array(selectionMeasureSchema).max(6),
  raw: z
    .record(z.string().max(64), selectionScalarSchema)
    .refine((value) => Object.keys(value).length <= 16, {
      message: "A visual selection can contain at most 16 raw fields.",
    }),
  source: z.string().max(100).optional(),
});

export const investigationFollowUpSchema = z.object({
  action: z.enum(INVESTIGATION_ACTIONS),
  originalQuery: z.string().max(2000).default(""),
  selection: investigationSelectionSchema,
});

export const trinetraClientDataSchema = z.object({
  followUp: investigationFollowUpSchema.optional(),
}).optional();

export type InvestigationAction = (typeof INVESTIGATION_ACTIONS)[number];
export type SelectionScalar = z.infer<typeof selectionScalarSchema>;
export type SelectionSemantic = (typeof SELECTION_SEMANTICS)[number];
export type SelectionFacet = z.infer<typeof selectionFacetSchema>;
export type SelectionMeasure = z.infer<typeof selectionMeasureSchema>;
export type InvestigationSelection = z.infer<
  typeof investigationSelectionSchema
>;
export type InvestigationFollowUp = z.infer<typeof investigationFollowUpSchema>;
export type SelectionRelation =
  | "selected"
  | "related"
  | "dimmed"
  | "default";

function normalizedField(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function canonicalVisualDimension(
  field: string,
  label?: string,
): SelectionSemantic {
  const fieldKey = normalizedField(field);
  const key = `${fieldKey}_${normalizedField(label ?? "")}`;
  if (/(^|_)trace_id(_|$)/.test(key) || fieldKey === "trace") {
    return "trace_id";
  }
  if (/(^|_)span_id(_|$)/.test(key) || fieldKey === "span") {
    return "span_id";
  }
  if (/(^|_)service(?:_name)?(_|$)/.test(key)) return "service";
  if (
    /(^|_)(operation|operation_name|span_name|endpoint|route|path)(_|$)/.test(
      key,
    )
  ) {
    return "operation";
  }
  if (/(^|_)(status|status_code|outcome|result)(_|$)/.test(key)) {
    return "status";
  }
  if (/(^|_)(region|zone|availability_zone|location)(_|$)/.test(key)) {
    return "region";
  }
  if (/(^|_)(environment|env|namespace|cluster)(_|$)/.test(key)) {
    return "environment";
  }
  if (/(^|_)(version|release|deployment|deploy|revision)(_|$)/.test(key)) {
    return "version";
  }
  if (
    /(^|_)(time|timestamp|date|minute|hour|bucket|window|interval|start_at|end_at)(_|$)/.test(
      key,
    )
  ) {
    return "time";
  }
  return "category";
}

function boundedScalar(value: unknown): SelectionScalar | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") return value.slice(0, 240);
  return undefined;
}

export function selectionPartsFromDatum(
  datum: Record<string, unknown>,
  options?: {
    dimensionFields?: readonly string[];
    measureFields?: readonly string[];
    labels?: Record<string, string | undefined>;
  },
) {
  const dimensions = new Set(options?.dimensionFields ?? []);
  const measures = new Set(options?.measureFields ?? []);
  const raw: Record<string, SelectionScalar> = {};
  const facets: SelectionFacet[] = [];
  const numericMeasures: SelectionMeasure[] = [];

  Object.entries(datum)
    .slice(0, 16)
    .forEach(([field, input]) => {
      const value = boundedScalar(input);
      if (value === undefined) return;
      const safeField = field.trim().slice(0, 64);
      if (!safeField || safeField in raw) return;
      const rawLabel = options?.labels?.[field]?.trim();
      const label = rawLabel ? rawLabel.slice(0, 64) : undefined;
      raw[safeField] = value;
      if (value === null) return;
      const semantic = canonicalVisualDimension(field, label);
      const forceDimension = dimensions.has(field);
      const forceMeasure = measures.has(field);

      if (
        forceDimension ||
        (!forceMeasure &&
          (typeof value !== "number" || semantic !== "category"))
      ) {
        if (facets.length < 10) {
          facets.push({ field: safeField, label, value, semantic });
        }
        return;
      }

      if (typeof value === "number" && numericMeasures.length < 6) {
        numericMeasures.push({ field: safeField, label, value });
      }
    });

  return { raw, facets, measures: numericMeasures };
}

export function createInvestigationSelection(input: {
  responseId: string;
  panelId: string;
  panelTitle: string;
  visualKind: InvestigationSelection["visualKind"];
  markId: string;
  label: string;
  datum: Record<string, unknown>;
  dimensionFields?: readonly string[];
  measureFields?: readonly string[];
  labels?: Record<string, string | undefined>;
  source?: string;
}): InvestigationSelection {
  const parts = selectionPartsFromDatum(input.datum, {
    dimensionFields: input.dimensionFields,
    measureFields: input.measureFields,
    labels: input.labels,
  });

  return investigationSelectionSchema.parse({
    version: 1,
    responseId: input.responseId.trim().slice(0, 100) || "response",
    panelId: input.panelId.trim().slice(0, 100) || "panel",
    panelTitle: input.panelTitle.trim().slice(0, 160) || "Visual evidence",
    visualKind: input.visualKind,
    markId: input.markId.trim().slice(0, 180) || "mark",
    label: input.label.trim().slice(0, 240) || "Selected evidence",
    ...parts,
    source: input.source?.trim().slice(0, 100) || undefined,
  });
}

function normalizedValue(value: SelectionScalar) {
  if (typeof value === "string") {
    return value.trim().toLowerCase().replaceAll(/[_\s]+/g, "-");
  }
  return value;
}

function facetsCompatible(left: SelectionFacet, right: SelectionFacet) {
  if (left.semantic !== "category" && left.semantic === right.semantic) {
    return true;
  }
  return normalizedField(left.field) === normalizedField(right.field);
}

function facetValuesEqual(left: SelectionScalar, right: SelectionScalar) {
  return normalizedValue(left) === normalizedValue(right);
}

export function selectionRelation(
  active: InvestigationSelection | null | undefined,
  candidate: InvestigationSelection,
): SelectionRelation {
  if (!active || active.responseId !== candidate.responseId) return "default";
  if (
    active.panelId === candidate.panelId &&
    active.markId === candidate.markId
  ) {
    return "selected";
  }

  let shared = 0;
  for (const activeFacet of active.facets) {
    const candidates = candidate.facets.filter((facet) =>
      facetsCompatible(activeFacet, facet),
    );
    if (candidates.length === 0) continue;
    shared += 1;
    if (
      !candidates.some((facet) =>
        facetValuesEqual(activeFacet.value, facet.value),
      )
    ) {
      return "dimmed";
    }
  }

  return shared > 0 ? "related" : "default";
}

function panelDimensionFields(panel: VisualPanel) {
  if (panel.kind === "chart") {
    return Object.keys(panel.spec.data[0] ?? {}).filter(
      (field) => field !== panel.spec.y.field,
    );
  }
  if (panel.kind === "table") {
    return panel.table.columns.map((column) => column.key);
  }
  if (panel.kind === "heatmap") {
    return [panel.heatmap.rowLabel ?? "row", panel.heatmap.columnLabel ?? "column"];
  }
  if (panel.kind === "trace") {
    return ["trace_id", "span_id", "service", "operation", "status"];
  }
  return panel.metrics.items.flatMap((item) => [item.label]);
}

export function visualPanelLinkState(
  panel: VisualPanel,
  selection: InvestigationSelection | null,
): "source" | "linked" | "unlinked" | "default" {
  if (!selection) return "default";
  if (panel.id === selection.panelId) return "source";
  const fields = panelDimensionFields(panel);
  const linked = selection.facets.some((facet) =>
    fields.some((field) => {
      const semantic = canonicalVisualDimension(field);
      return (
        (facet.semantic !== "category" && facet.semantic === semantic) ||
        normalizedField(facet.field) === normalizedField(field)
      );
    }),
  );
  return linked ? "linked" : "unlinked";
}

const ACTION_COPY: Record<
  InvestigationAction,
  { visible: string; instruction: string }
> = {
  explain: {
    visible: "Explain",
    instruction:
      "Explain the strongest data-backed drivers of this selected evidence within its exact scope.",
  },
  compare: {
    visible: "Compare",
    instruction:
      "Compare this selection with the closest equivalent healthy baseline and relevant peers.",
  },
  find_evidence: {
    visible: "Find evidence",
    instruction:
      "Find exact logs, events, rows, or coherent traces that support or contradict this selection.",
  },
};

export function selectionShortLabel(selection: InvestigationSelection) {
  const priority: Record<SelectionSemantic, number> = {
    service: 0,
    time: 1,
    operation: 2,
    status: 3,
    region: 4,
    environment: 5,
    version: 6,
    trace_id: 7,
    span_id: 8,
    category: 9,
  };
  const facets = [...selection.facets]
    .sort((left, right) => priority[left.semantic] - priority[right.semantic])
    .slice(0, 3)
    .map((facet) => `${facet.label ?? facet.field} ${String(facet.value)}`);
  const measures = selection.measures
    .slice(0, Math.max(1, 3 - facets.length))
    .map((measure) => `${measure.label ?? measure.field} ${measure.value}`);
  return [...facets, ...measures].join(" · ") || selection.label;
}

export function visibleSelectionActionText(
  action: InvestigationAction,
  selection: InvestigationSelection,
) {
  return `${ACTION_COPY[action].visible} ${selectionShortLabel(selection)} from “${selection.panelTitle}”`.slice(
    0,
    360,
  );
}

export function buildSelectionFollowUpQuery(
  visibleText: string,
  followUp: InvestigationFollowUp,
) {
  const parsed = investigationFollowUpSchema.parse(followUp);
  const { selection, action, originalQuery } = parsed;
  const facets = selection.facets
    .map(
      (facet) =>
        `${facet.semantic}:${facet.field}=${JSON.stringify(facet.value)}`,
    )
    .join(", ");
  const measures = selection.measures
    .map((measure) => `${measure.field}=${measure.value}`)
    .join(", ");
  const raw = JSON.stringify(selection.raw);
  const essentialContext = `SCOPED VISUAL FOLLOW-UP
Action: ${action}
Source visual: ${selection.panelTitle} (${selection.visualKind})
Selected facets: ${(facets || "none").slice(0, 520)}
Selected measures: ${(measures || "none").slice(0, 220)}
Selected datum: ${raw.slice(0, 360)}
Instruction: ${ACTION_COPY[action].instruction}
Visible request: ${visibleText.slice(0, 240)}
Use ClickHouse as the source of truth. Stay inside the selected facets unless a
baseline comparison requires an adjacent window or peer. Return the smallest
set of focused, interactive visuals that answers this follow-up; do not repeat
unrelated panels from the previous answer.
Original question: `;

  const originalBudget = Math.max(0, 2000 - essentialContext.length);
  return `${essentialContext}${(originalQuery || "not supplied").slice(
    0,
    originalBudget,
  )}`.slice(0, 2000);
}
