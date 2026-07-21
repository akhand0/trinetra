"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import { ArrowLeft, Send, Sparkles, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mintChatAccessToken, startChatSession } from "@/app/actions";
import { ChartSpecView } from "@/components/visualizations";
import { safeParseChartSpec } from "@/lib/telemetry/chart-spec";
import type { trinetraAgent } from "@/trigger/agent";

export function TriggerLiveChat({
  initialPrompt,
  requestId,
  onBack,
}: {
  initialPrompt?: string;
  requestId?: string;
  onBack: () => void;
}) {
  const initialPromptSent = useRef(false);
  const [input, setInput] = useState(
    initialPrompt ? "" : "Why did checkout latency spike after Tuesday's deploy?",
  );
  const transport = useTriggerChatTransport<typeof trinetraAgent>({
    task: "trinetra-agent",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startChatSession({ chatId, clientData }),
  });
  const { error, messages, sendMessage, status } = useChat({ transport });

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!prompt || initialPromptSent.current) return;

    const storageKey = `trinetra-agent-request:${requestId ?? prompt}`;
    if (window.sessionStorage.getItem(storageKey)) return;

    initialPromptSent.current = true;
    window.sessionStorage.setItem(storageKey, "sent");
    void sendMessage({ text: prompt });
  }, [initialPrompt, requestId, sendMessage]);

  return (
    <main className="live-page">
      <header>
        <button type="button" onClick={onBack}>
          <ArrowLeft size={14} /> Back
        </button>
        <span>
          <Zap size={13} /> Trigger.dev durable session
        </span>
      </header>
      <section>
        <div className="live-intro">
          <Sparkles size={18} />
          <h1>Live agent transport</h1>
          <p>
            This surface connects useChat directly to the trinetra-agent
            session. Probe tasks stream typed data-panel parts into this turn.
          </p>
        </div>
        <div className="live-messages">
          {messages.map((message) => (
            <article className={message.role} key={message.id}>
              <span>{message.role}</span>
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  return <p key={index}>{part.text}</p>;
                }
                if (part.type === "data-panel") {
                  const data = part.data as {
                    title?: string;
                    finding?: string;
                    spec?: unknown;
                  };
                  const spec = safeParseChartSpec(data.spec);
                  return (
                    <div className="live-data-part" key={index}>
                      <small>{spec ? "AGENT-COMPOSED CHART" : "STREAMED PANEL"}</small>
                      <b>{data.title ?? "Probe panel"}</b>
                      {spec && <ChartSpecView spec={spec} compact />}
                      <p>{data.finding}</p>
                    </div>
                  );
                }
                return null;
              })}
            </article>
          ))}
          {status === "streaming" && <div className="live-thinking">Investigating…</div>}
          {error && (
            <div className="live-thinking" role="alert">
              The agent run failed: {error.message}
            </div>
          )}
        </div>
        <form
          className="live-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (!input.trim()) return;
            sendMessage({ text: input });
            setInput("");
          }}
        >
          <input value={input} onChange={(event) => setInput(event.target.value)} />
          <button disabled={status === "streaming" || !input.trim()}>
            <Send size={14} /> Investigate
          </button>
        </form>
      </section>
    </main>
  );
}
