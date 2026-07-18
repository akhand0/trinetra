import { createEpisode, recordDecision } from "@/lib/postgres/episodes";
import { classifyContext } from "@/lib/policy/context";
import { chooseArms } from "@/lib/policy/thompson";
import {
  INITIAL_POSTERIORS,
  PANELS,
  ROOT_CAUSE,
} from "@/lib/telemetry/mock-data";
import type { InvestigationEvent, ProbeArm } from "@/lib/types";

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

export async function POST(request: Request) {
  const body = (await request.json()) as { query?: string; chatId?: string };
  const query = body.query?.trim();

  if (!query) {
    return Response.json({ error: "A query is required" }, { status: 400 });
  }

  const episodeId = crypto.randomUUID();
  const chatId = body.chatId ?? `chat-${episodeId.slice(0, 8)}`;
  const context = classifyContext(query);
  const choices = chooseArms(INITIAL_POSTERIORS, 3, seededRandom(2048));

  await createEpisode({ id: episodeId, chatId, query, context });
  await Promise.all(
    choices.map((choice, index) => recordDecision(episodeId, index, choice)),
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: InvestigationEvent) => controller.enqueue(line(event));
      const pause = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      send({
        type: "episode",
        episodeId,
        message: `Classified as ${context}`,
      });
      send({ type: "posterior", posterior: INITIAL_POSTERIORS });

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
          detail: `${choices.length + 2} candidate probes`,
          status: "complete",
          duration: "4 ms",
        },
      });

      for (const [index, choice] of choices.entries()) {
        const panel = armPanel(choice.arm);
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
      send({ type: "root_cause", rootCause: ROOT_CAUSE });
      send({ type: "done", message: "Initial fan-out complete" });
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
