"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import { ArrowLeft, Send, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { mintChatAccessToken, startChatSession } from "@/app/actions";
import type { trinetraAgent } from "@/trigger/agent";

export function TriggerLiveChat() {
  const [input, setInput] = useState(
    "Why did checkout latency spike after Tuesday's deploy?",
  );
  const transport = useTriggerChatTransport<typeof trinetraAgent>({
    task: "trinetra-agent",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startChatSession({ chatId, clientData }),
  });
  const { messages, sendMessage, status } = useChat({ transport });

  return (
    <main className="live-page">
      <header>
        <Link href="/">
          <ArrowLeft size={14} /> Back to canvas
        </Link>
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
                  const data = part.data as { title?: string; finding?: string };
                  return (
                    <div className="live-data-part" key={index}>
                      <small>STREAMED PANEL</small>
                      <b>{data.title ?? "Probe panel"}</b>
                      <p>{data.finding}</p>
                    </div>
                  );
                }
                return null;
              })}
            </article>
          ))}
          {status === "streaming" && <div className="live-thinking">Investigating…</div>}
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
