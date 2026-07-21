import { task } from "@trigger.dev/sdk";
import { Resend } from "resend";
import {
  renderVisualReportPdf,
  visualReportPdfFilename,
} from "@/lib/reports/visual-report-pdf";
import {
  visualResponseSchema,
  type VisualResponseData,
} from "@/lib/telemetry/visual-response";
import { runInvestigationTeam } from "./investigation-team";
import { reportStream } from "./report-stream";

type VisualReportPayload = {
  query: string;
  email?: string;
  report?: VisualResponseData;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function reportEmailHtml(report: VisualResponseData, runId: string) {
  return `
    <main style="max-width:620px;margin:0 auto;padding:32px;font-family:Inter,Arial,sans-serif;color:#211c25">
      <p style="margin:0;color:#8f43ca;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Trinetra PDF report</p>
      <h1 style="margin:10px 0 8px;font-size:28px;letter-spacing:-.03em">${escapeHtml(report.title)}</h1>
      <p style="margin:0 0 22px;color:#5d5662;font-size:15px;line-height:1.55">${escapeHtml(report.verdict)}</p>
      <div style="padding:16px 18px;border:1px solid #e8dcf3;border-radius:12px;background:#faf7fc">
        <strong>The complete visual report is attached as a PDF.</strong>
        <p style="margin:7px 0 0;color:#6f6874">${report.panels.length} visual level${report.panels.length === 1 ? "" : "s"}: metrics, charts, and evidence tables.</p>
      </div>
      <p style="margin-top:24px;color:#8a838e;font-size:11px">Trigger.dev run ${escapeHtml(runId)}</p>
    </main>`;
}

export const visualReportTask = task({
  id: "visual-report",
  run: async (payload: VisualReportPayload, { ctx }) => {
    const query = payload.query.trim();
    const email = payload.email?.trim();
    const suppliedReport = visualResponseSchema.safeParse(payload.report);

    if (!query) throw new Error("A report query is required.");

    await reportStream.append({
      step: "starting",
      message: "Starting visual report",
      data: null,
    });

    let report: VisualResponseData;
    if (suppliedReport.success && suppliedReport.data.status === "complete") {
      report = suppliedReport.data;
      await reportStream.append({
        step: "composing",
        message: `Using ${report.panels.length} completed visual level${report.panels.length === 1 ? "" : "s"}`,
        data: report,
      });
    } else {
      const result = await runInvestigationTeam(
        { query },
        undefined,
        {
          publish: async (response) => {
            await reportStream.append({
              step:
                response.status === "running" ? "investigating" : "composing",
              message:
                response.status === "running"
                  ? "Specialists are querying ClickHouse"
                  : `Composed ${response.panels.length} visual level${response.panels.length === 1 ? "" : "s"}`,
              data: response,
            });
          },
        },
      );
      report = result.report;
    }

    let emailed = false;
    let deliveryMessage = "Visual report ready";

    if (email) {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.RESEND_FROM_EMAIL;

      if (!apiKey || !from) {
        deliveryMessage =
          "Report ready — add RESEND_API_KEY and RESEND_FROM_EMAIL to enable delivery";
      } else {
        await reportStream.append({
          step: "emailing",
          message: `Sending report to ${email}`,
          data: report,
        });

        try {
          const pdf = await renderVisualReportPdf(report, ctx.run.id);
          const delivery = await new Resend(apiKey).emails.send({
            from,
            to: email,
            subject: `Trinetra PDF report: ${report.title}`,
            html: reportEmailHtml(report, ctx.run.id),
            attachments: [
              {
                filename: visualReportPdfFilename(report),
                content: pdf,
                contentType: "application/pdf",
              },
            ],
          });

          if (delivery.error) {
            throw new Error(delivery.error.message);
          }
          emailed = true;
          deliveryMessage = `PDF report sent to ${email}`;
        } catch (error) {
          deliveryMessage = `Report ready — email delivery failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`;
        }
      }
    }

    await reportStream.append({
      step: "done",
      message: deliveryMessage,
      data: report,
      emailed,
    });

    return {
      runId: ctx.run.id,
      report,
      emailed,
      deliveryMessage,
    };
  },
});
