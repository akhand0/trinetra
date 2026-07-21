"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import { MoreVertical, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mintChatAccessToken, startChatSession } from "@/app/actions";
import {
  VisualResponse,
  VisualResponseGroup,
  type VisualPanelPayload,
} from "@/components/visual-response";
import type { trinetraAgent } from "@/trigger/agent";

function normalizeAgentMarkdown(text: string) {
  return text.replace(
    /[ \t]+(?=(\d+)\.\s+`)/g,
    (_space, itemNumber: string) => (itemNumber === "1" ? "\n\n" : "\n"),
  );
}

export function AgentHome() {
  const [message, setMessage] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);
  const transport = useTriggerChatTransport<typeof trinetraAgent>({
    task: "trinetra-agent",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startChatSession({ chatId, clientData }),
  });
  const { error, messages, sendMessage, status } = useChat({ transport });
  const isRunning = status === "submitted" || status === "streaming";
  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (!hasMessages) return;
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [hasMessages, messages, status]);

  function startTesting() {
    const prompt = message.trim();
    if (!prompt || isRunning) return;
    setMessage("");
    void sendMessage({ text: prompt });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTesting();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      startTesting();
    }
  }

  return (
    <main className="agent-home">
      <button className="agent-menu" aria-label="Open menu">
        <MoreVertical size={24} strokeWidth={2.5} />
      </button>

      <section className={`agent-start${hasMessages ? " has-thread" : ""}`}>
        <h1>
          {!hasMessages && <span>Welcome to</span>}
          <span className="agent-name">
            <i className="agent-badge" aria-hidden="true">
              <Sparkles size={22} fill="currentColor" strokeWidth={1.7} />
            </i>
            trinetra-agent
          </span>
        </h1>

        {hasMessages && (
          <div
            className="agent-thread"
            aria-label="Conversation with trinetra-agent"
            aria-live="polite"
          >
            {messages.map((chatMessage, messageIndex) => (
              <article
                className={`${chatMessage.role}${
                  chatMessage.parts.some(
                    (part) =>
                      part.type === "data-panel" ||
                      part.type === "data-visual-response",
                  )
                    ? " has-visual"
                    : ""
                }${
                  chatMessage.parts.some(
                    (part) => part.type === "data-visual-response",
                  )
                    ? " has-composed-visual"
                    : ""
                }`}
                key={chatMessage.id}
              >
                <span>{chatMessage.role === "user" ? "You" : "Trinetra"}</span>
                {chatMessage.parts.map((part, index) => {
                  const partKey =
                    (part as { id?: string }).id ?? `${part.type}-${index}`;
                  if (part.type === "text") {
                    return chatMessage.role === "assistant" ? (
                      <div className="agent-markdown" key={partKey}>
                        <Markdown remarkPlugins={[remarkGfm]}>
                          {normalizeAgentMarkdown(part.text)}
                        </Markdown>
                      </div>
                    ) : (
                      <p key={partKey}>{part.text}</p>
                    );
                  }
                  if (part.type === "data-panel") {
                    return (
                      <VisualResponse
                        data={part.data as VisualPanelPayload}
                        key={partKey}
                      />
                    );
                  }
                  if (part.type === "data-visual-response") {
                    const previousUserPrompt = messages
                      .slice(0, messageIndex)
                      .toReversed()
                      .find((candidate) => candidate.role === "user")
                      ?.parts.find((candidate) => candidate.type === "text");
                    return (
                      <VisualResponseGroup
                        data={part.data}
                        query={previousUserPrompt?.text}
                        key={partKey}
                      />
                    );
                  }
                  return null;
                })}
              </article>
            ))}
            {isRunning && (
              <div className="agent-thinking" role="status">
                <span aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                Trinetra is thinking
              </div>
            )}
            {error && (
              <div className="agent-error" role="alert">
                The agent run failed: {error.message}
              </div>
            )}
            <div ref={threadEndRef} />
          </div>
        )}

        <form
          className="agent-composer"
          aria-label="Message composer"
          onSubmit={handleSubmit}
        >
          <textarea
            autoFocus
            aria-label="Message to trinetra-agent"
            placeholder="Type a message..."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <p>Press Enter to send, Shift+Enter for new line</p>
          <button
            type="button"
            disabled={isRunning || !message.trim()}
            onClick={startTesting}
          >
            <Send size={18} />
            {isRunning ? "Thinking" : "Send"}
          </button>
        </form>
      </section>
    </main>
  );
}
