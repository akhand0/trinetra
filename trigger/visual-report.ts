import { task } from "@trigger.dev/sdk";
import { Resend } from "resend";
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

function reportHtml(report: VisualResponseData, runId: string) {
  const panels = report.panels
    .map(
      (panel) => `
        <article style="margin:16px 0;padding:18px;border:1px solid #e8dcf3;border-radius:14px">
          <p style="margin:0 0 5px;color:#8f43ca;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(panel.eyebrow)}</p>
          <h2 style="margin:0 0 8px;font-size:18px">${escapeHtml(panel.title)}</h2>
          <p style="margin:0;color:#4f4955;line-height:1.5">${escapeHtml(panel.finding)}</p>
        </article>`,
    )
    .join("");

  return `
    <main style="max-width:680px;margin:0 auto;padding:32px;font-family:Inter,Arial,sans-serif;color:#211c25">
      <p style="margin:0;color:#8f43ca;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Trinetra visual report</p>
      <h1 style="margin:10px 0 8px;font-size:30px;letter-spacing:-.03em">${escapeHtml(report.title)}</h1>
      <p style="margin:0 0 24px;color:#5d5662;font-size:16px;line-height:1.55">${escapeHtml(report.verdict)}</p>
      ${panels}
      <p style="margin-top:28px;color:#8a838e;font-size:11px">Trigger.dev run ${escapeHtml(runId)}</p>
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
          const delivery = await new Resend(apiKey).emails.send({
            from,
            to: email,
            subject: `Trinetra report: ${report.title}`,
            html: reportHtml(report, ctx.run.id),
          });

          if (delivery.error) {
            throw new Error(delivery.error.message);
          }
          emailed = true;
          deliveryMessage = `Visual report sent to ${email}`;
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
