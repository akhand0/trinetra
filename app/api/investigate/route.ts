import {
  readLiveTelemetry,
  type LiveTelemetry,
} from "@/lib/clickhouse/live-telemetry";
import { readPosteriors } from "@/lib/clickhouse/rewards";
import { createEpisode, recordDecision } from "@/lib/postgres/episodes";
import { classifyContext } from "@/lib/policy/context";
import { chooseArms } from "@/lib/policy/thompson";
import {
  INITIAL_POSTERIORS,
  PANELS,
  ROOT_CAUSE,
} from "@/lib/telemetry/mock-data";
import type {
  InvestigationEvent,
  PanelData,
  ProbeArm,
  RootCause,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function line(event: InvestigationEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function armPanel(arm: ProbeArm) {
  const byArm: Record<ProbeArm, keyof typeof PANELS> = {
    latency_shift: "timeline",
    error_cluster: "heatmap",
    deploy_correlation: "deploy",
    trace_mining: "trace",
    cardinality_scan: "cardinality",
  };
  return PANELS[byArm[arm]];
}

/**
 * Overlays live ClickHouse telemetry onto a seeded panel while preserving the
 * panel's visual contract (kind, accent, chart shape). When no live signal is
 * available for an arm the seeded panel passes through unchanged.
 */
function overlayPanel(panel: PanelData, live: LiveTelemetry): PanelData {
  switch (panel.arm) {
    case "latency_shift": {
      if (!live.latencySeries.length || live.topLatencyP99Ms === null) {
        return panel;
      }
      const before = live.baselineP99Ms ?? live.latencySeries[0].value;
      const after = live.topLatencyP99Ms;
      const changePct =
        before > 0 ? Math.round(((after - before) / before) * 100) : 0;
      return {
        ...panel,
        title: `${live.topLatencyService} p99 at ${after} ms over ${live.windowMinutes}m`,
        finding: `${live.topLatencyService} p99 ${after} ms (baseline ${before} ms, ${changePct >= 0 ? "+" : ""}${changePct}%)`,
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
        title: hasErrors
          ? `${live.topErrorService ?? "Errors"} concentrates the failures`
          : "No error concentration in window",
        finding: hasErrors
          ? `${live.errorSpans} error spans · ${live.errorLogs} error logs`
          : "0 error spans across the live window",
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
          {
            label: "Services",
            value: `${live.services}`,
            tone: "neutral",
          },
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
      if (!live.slowestTrace) return panel;
      const t = live.slowestTrace;
      return {
        ...panel,
        title: `${t.service} · ${t.op} is the slowest span`,
        finding: `${t.traceId.slice(0, 8)} · ${t.service} · ${t.op}`,
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
          {
            label: "Metrics",
            value: `${live.metricNames}`,
            tone: "good",
          },
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

  const episodeId = crypto.randomUUID();
  const chatId = body.chatId ?? `chat-${episodeId.slice(0, 8)}`;
  const context = classifyContext(query);

  const [live, posteriors] = await Promise.all([
    readLiveTelemetry().catch(() => null),
    readPosteriors(context).catch(() => INITIAL_POSTERIORS),
  ]);

  const choices = chooseArms(posteriors, 3, seededRandom(2048));

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

      const headline = live
        ? `Classified as ${context} · ${live.spanCount} spans / ${live.services} services live`
        : `Classified as ${context}`;

      send({ type: "episode", episodeId, message: headline });
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
          detail: live
            ? `${choices.length + 2} probes · clickhouse`
            : `${choices.length + 2} candidate probes`,
          status: "complete",
          duration: "4 ms",
        },
      });

      for (const [index, choice] of choices.entries()) {
        const base = armPanel(choice.arm);
        const panel = live ? overlayPanel(base, live) : base;
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
      send({
        type: "root_cause",
        rootCause: live ? liveRootCause(live) : ROOT_CAUSE,
      });
      send({
        type: "done",
        message: live
          ? "Live fan-out complete"
          : "Initial fan-out complete",
      });
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
