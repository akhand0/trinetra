export const VISUAL_DELIVERABLES = ["verdict", "series", "rows"] as const;

export type VisualDeliverable = (typeof VISUAL_DELIVERABLES)[number];

export type SubmissionToolName =
  | "submitMetrics"
  | "submitChart"
  | "submitTable"
  | "submitHeatmap"
  | "submitTrace";

const SUBMISSION_TOOLS: Record<
  VisualDeliverable,
  readonly SubmissionToolName[]
> = {
  verdict: ["submitMetrics", "submitChart"],
  series: ["submitChart", "submitHeatmap"],
  rows: ["submitTable", "submitTrace"],
};

const VISUAL_KINDS: Record<VisualDeliverable, readonly string[]> = {
  verdict: ["metrics", "chart"],
  series: ["chart", "heatmap"],
  rows: ["table", "trace"],
};

export function submissionToolsForDeliverable(
  deliverable: VisualDeliverable,
) {
  return [...SUBMISSION_TOOLS[deliverable]];
}

export function visualKindSupportsDeliverable(
  deliverable: VisualDeliverable,
  kind: string,
) {
  return VISUAL_KINDS[deliverable].includes(kind);
}

export function visualDeliverableFromAssignment(
  assignment: unknown,
): VisualDeliverable {
  let text: string;
  try {
    text =
      typeof assignment === "string" ? assignment : JSON.stringify(assignment);
  } catch {
    return "verdict";
  }

  const match = text.match(/DELIVERABLE:\s*(verdict|series|rows)\b/i);
  const candidate = match?.[1]?.toLowerCase();
  return VISUAL_DELIVERABLES.includes(candidate as VisualDeliverable)
    ? (candidate as VisualDeliverable)
    : "verdict";
}
