"use client";

import { MoreVertical, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { TriggerLiveChat } from "@/components/trigger-live-chat";

type ActivePrompt = {
  prompt: string;
  requestId: string;
};

export function AgentHome() {
  const [message, setMessage] = useState("");
  const [activePrompt, setActivePrompt] = useState<ActivePrompt | null>(null);

  function startTesting() {
    const prompt = message.trim();
    if (!prompt) return;
    setActivePrompt({ prompt, requestId: crypto.randomUUID() });
    setMessage("");
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

  if (activePrompt) {
    return (
      <TriggerLiveChat
        initialPrompt={activePrompt.prompt}
        requestId={activePrompt.requestId}
        onBack={() => setActivePrompt(null)}
      />
    );
  }

  return (
    <main className="agent-home">
      <button className="agent-menu" aria-label="Open menu">
        <MoreVertical size={24} strokeWidth={2.5} />
      </button>

      <section className="agent-start">
        <h1>
          <span>Type a message to start testing</span>
          <span className="agent-name">
            <i className="agent-badge" aria-hidden="true">
              <Sparkles size={22} fill="currentColor" strokeWidth={1.7} />
            </i>
            trinetra-agent
          </span>
        </h1>

        <form className="agent-composer" onSubmit={handleSubmit}>
          <textarea
            autoFocus
            aria-label="Message to trinetra-agent"
            placeholder="Type a message..."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <p>Press Enter to send, Shift+Enter for new line</p>
          <button type="submit" disabled={!message.trim()}>
            <Zap size={22} fill="currentColor" />
            Preload
          </button>
        </form>
      </section>
    </main>
  );
}
