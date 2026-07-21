"use client";

import { MoreVertical, Sparkles, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

export function AgentHome() {
  const router = useRouter();
  const [message, setMessage] = useState("");

  function startTesting() {
    const prompt = message.trim();
    if (!prompt) return;
    router.push(`/live?prompt=${encodeURIComponent(prompt)}`);
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
