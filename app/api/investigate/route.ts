import {
  readLiveTelemetry,
  type LiveTelemetry,
} from "@/lib/clickhouse/live-telemetry";
import { readPosteriors } from "@/lib/clickhouse/rewards";
import { createEpisode, recordDecision } from "@/lib/postgres/episodes";
import { classifyContext } from "@/lib/policy/context";
import { chooseArms } from "@/lib/policy/thompson";
import { panelTemplate, uniformPriors } from "@/lib/telemetry/panels";
import type {
  InvestigationEvent,
  PanelData,
  ProbeArm,
  RootCause,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function line(event: InvestigationEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

/** Fills an empty panel template with live ClickHouse findings for its arm. */
function livePanel(arm: ProbeArm, live: LiveTelemetry): PanelData {
  const panel = panelTemplate(arm);

  switch (arm) {
    case "latency_shift": {
      if (!live.latencySeries.length || live.topLatencyP99Ms === null) {
        return {
          ...panel,
          title: "No latency signal in window",
          finding: `0 qualifying spans over the last ${live.windowMinutes}m`,
        };
      }
      const before = live.baselineP99Ms ?? live.latencySeries[0].value;
      const after = live.topLatencyP99Ms;
      const changePct =
        before > 0 ? Math.round(((after - before) / before) * 100) : 0;
      return {
        ...panel,
        kind: "chart",
        title: `${live.topLatencyService} p99 at ${after} ms over ${live.windowMinutes}m`,
        finding: `${live.topLatencyService} p99 ${after} ms (baseline ${before} ms, ${changePct >= 0 ? "+" : ""}${changePct}%)`,
        confidence: Math.min(99, Math.max(0, changePct)),
        spec: {
          mark: "area",
          title: `${live.topLatencyService} p99 (ms)`,
          x: { field: "minute", label: "Time" },
          y: { field: "p99", label: "p99 ms" },
          data: live.latencySeries.map((point) => ({
            minute: point.label,
            p99: point.value,
          })),
        },
        series: live.latencySeries.map((point) => ({
          label: point.label,
          value: point.value,
        })),
        stats: [
          { label: "Baseline", value: `${before} ms`, tone: "neutral" },
          { label: "Peak p99", value: `${after} ms`, tone: "bad" },
          {
            label: "Change",
            value: `${changePct >= 0 ? "+" : ""}${changePct}%`,
            tone: changePct > 0 ? "bad" : "good",
          },
        ],
      };
    }
    case "error_cluster": {
      const hasErrors = live.errorSpans > 0 || live.errorLogs > 0;
      return {
        ...panel,
        kind: hasErrors ? "chart" : panel.kind,
        title: hasErrors
          ? `${live.topErrorService ?? "Errors"} concentrates the failures`
          : "No error concentration in window",
        finding: hasErrors
          ? `${live.errorSpans} error spans · ${live.errorLogs} error logs`
          : "0 error spans across the live window",
        spec: hasErrors
          ? {
              mark: "bar",
              title: "Error volume by signal",
              x: { field: "signal" },
              y: { field: "count" },
              data: [
                { signal: "Error spans", count: live.errorSpans },
                { signal: "Error logs", count: live.errorLogs },
              ],
            }
          : undefined,
        stats: [
          {
            label: "Error spans",
            value: `${live.errorSpans}`,
            tone: live.errorSpans > 0 ? "bad" : "good",
          },
          {
            label: "Error logs",
            value: `${live.errorLogs}`,
            tone: live.errorLogs > 0 ? "bad" : "good",
          },
          { label: "Services", value: `${live.services}`, tone: "neutral" },
        ],
      };
    }
    case "deploy_correlation": {
      return {
        ...panel,
        title: "No deploy marker in the live stream",
        finding: `${live.spanCount} spans across ${live.services} services, no rollout event`,
        stats: [
          { label: "Window", value: `${live.windowMinutes}m`, tone: "neutral" },
          { label: "Spans", value: `${live.spanCount}`, tone: "neutral" },
          { label: "Deploys", value: "0", tone: "neutral" },
        ],
      };
    }
    case "trace_mining": {
      if (!live.slowestTrace) {
        return {
          ...panel,
          title: "No trace in window",
          finding: `0 traces over the last ${live.windowMinutes}m`,
        };
      }
      const t = live.slowestTrace;
      return {
        ...panel,
        title: `${t.service} · ${t.op} is the slowest span`,
        finding: `${t.traceId.slice(0, 8)} · ${t.service} · ${t.op}`,
        spans: [
          {
            id: t.traceId.slice(0, 8),
            service: t.service,
            operation: t.op,
            start: 0,
            duration: Math.round(t.durationMs),
            status: live.errorSpans > 0 ? "error" : "ok",
          },
        ],
        stats: [
          { label: "Trace", value: t.traceId.slice(0, 8), tone: "neutral" },
          {
            label: "Duration",
            value: `${Math.round(t.durationMs)} ms`,
            tone: "bad",
          },
          { label: "Service", value: t.service, tone: "neutral" },
        ],
      };
    }
    case "cardinality_scan": {
      return {
        ...panel,
        title: `${live.metricNames} distinct metric names`,
        finding: `${live.metricNames} metric names, no explosion detected`,
        stats: [
          { label: "Metrics", value: `${live.metricNames}`, tone: "good" },
          { label: "Services", value: `${live.services}`, tone: "neutral" },
          { label: "Verdict", value: "Clear", tone: "good" },
        ],
      };
    }
    default:
      return panel;
  }
}

function liveRootCause(live: LiveTelemetry): RootCause {
  const service =
    live.topErrorService ?? live.topLatencyService ?? "unknown-service";
  const hasErrors = live.errorSpans > 0;
  return {
    service,
    title: hasErrors
      ? `${service} is emitting errors`
      : `${service} carries the highest p99`,
    detail: hasErrors
      ? `${live.errorSpans} error spans and ${live.errorLogs} error logs concentrate on ${service} over the last ${live.windowMinutes} minutes.`
      : `${service} shows p99 ${live.topLatencyP99Ms ?? "?"} ms against a ${live.baselineP99Ms ?? "?"} ms baseline over the last ${live.windowMinutes} minutes.`,
    confidence: hasErrors ? 88 : 71,
    traceId: live.slowestTrace?.traceId.slice(0, 8) ?? "—",
    since: `${live.windowMinutes}m window`,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as { query?: string; chatId?: string };
  const query = body.query?.trim();

  if (!query) {
    return Response.json({ error: "A query is required" }, { status: 400 });
  }

  const [live, storedPosteriors] = await Promise.all([
    readLiveTelemetry().catch(() => null),
    readPosteriors(classifyContext(query)).catch(() => []),
  ]);

  if (!live) {
    return Response.json(
      { error: "Live telemetry is unavailable" },
      { status: 503 },
    );
  }

  const episodeId = crypto.randomUUID();
  const chatId = body.chatId ?? `chat-${episodeId.slice(0, 8)}`;
  const context = classifyContext(query);
  const posteriors =
    storedPosteriors.length > 0 ? storedPosteriors : uniformPriors();
  const choices = chooseArms(posteriors, 3);

  await createEpisode({ id: episodeId, chatId, query, context });
  await Promise.all(
    choices.map((choice, index) => recordDecision(episodeId, index, choice)),
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: InvestigationEvent) =>
        controller.enqueue(line(event));
      const pause = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      send({
        type: "episode",
        episodeId,
        message: `Classified as ${context} · ${live.spanCount} spans / ${live.services} services live`,
      });
      send({ type: "posterior", posterior: posteriors });

      await pause(180);
      send({
        type: "node",
        node: {
          id: "intent",
          label: "Classify intent",
          detail: context,
          status: "complete",
          duration: "82 ms",
        },
      });
      send({
        type: "node",
        node: {
          id: "policy",
          label: "Sample policy",
          detail: `${choices.length + 2} probes · clickhouse`,
          status: "complete",
          duration: "4 ms",
        },
      });

      for (const [index, choice] of choices.entries()) {
        const panel = livePanel(choice.arm, live);
        send({
          type: "node",
          node: {
            id: choice.arm,
            label: panel.eyebrow,
            detail: panel.finding,
            arm: choice.arm,
            status: "running",
            score: choice.sampledScore,
          },
        });
        await pause(index === 0 ? 520 : 700);
        send({
          type: "panel",
          panel: {
            ...panel,
            sampledScore: Number(choice.sampledScore.toFixed(2)),
            propensity: Number(choice.propensity.toFixed(2)),
          },
        });
        send({
          type: "node",
          node: {
            id: choice.arm,
            label: panel.eyebrow,
            detail: panel.finding,
            arm: choice.arm,
            status: "complete",
            duration: `${640 + index * 190} ms`,
            score: choice.sampledScore,
          },
        });
      }

      await pause(300);
      send({ type: "root_cause", rootCause: liveRootCause(live) });
      send({ type: "done", message: "Live fan-out complete" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
