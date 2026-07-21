import { streams } from "@trigger.dev/sdk";
import type { VisualResponseData } from "@/lib/telemetry/visual-response";

export type VisualReportStep =
  | "starting"
  | "investigating"
  | "composing"
  | "emailing"
  | "done";

export type VisualReportProgress = {
  step: VisualReportStep;
  message: string;
  data: VisualResponseData | null;
  emailed?: boolean;
};

/** Run-scoped progress shared by the Trigger task and the React client. */
export const reportStream = streams.define<VisualReportProgress>({
  id: "visual-report-progress",
});
