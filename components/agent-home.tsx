"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import { Mic, MoreVertical, Send, Sparkles, Square } from "lucide-react";
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
import { safeParseVisualResponse } from "@/lib/telemetry/visual-response";
import type { trinetraAgent } from "@/trigger/agent";

function normalizeAgentMarkdown(text: string) {
  return text.replace(
    /[ \t]+(?=(\d+)\.\s+`)/g,
    (_space, itemNumber: string) => (itemNumber === "1" ? "\n\n" : "\n"),
  );
}

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function speechRecognitionConstructor() {
  if (typeof window === "undefined") return undefined;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function voiceErrorMessage(error: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone access is blocked. Allow it in your browser and try again.";
  }
  if (error === "audio-capture") {
    return "No microphone was found.";
  }
  if (error === "no-speech") {
    return "I didn't hear anything. Tap the microphone and try again.";
  }
  return "Voice input stopped. Please try again.";
}

function assistantSpeech(parts: readonly unknown[]) {
  const fragments: string[] = [];
  for (const rawPart of parts) {
    const part = rawPart as { type?: string; text?: string; data?: unknown };
    if (part.type === "text" && part.text?.trim()) {
      fragments.push(part.text.trim());
      continue;
    }
    if (part.type === "data-visual-response") {
      const response = safeParseVisualResponse(part.data);
      if (response?.verdict) fragments.push(response.verdict);
      continue;
    }
    if (part.type === "data-panel") {
      const panel = part.data as VisualPanelPayload | undefined;
      if (panel?.finding) fragments.push(panel.finding);
    }
  }
  return [...new Set(fragments)].join(" ").replace(/\s+/g, " ").slice(0, 700);
}

export function AgentHome() {
  const [message, setMessage] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceBaseRef = useRef("");
  const voiceFinalRef = useRef("");
  const voiceLatestRef = useRef("");
  const voiceHeardRef = useRef(false);
  const voiceCanceledRef = useRef(false);
  const awaitingVoiceReplyRef = useRef(false);
  const spokenMessageIdRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (error) {
      awaitingVoiceReplyRef.current = false;
      return;
    }
    if (!awaitingVoiceReplyRef.current || isRunning) return;
    const latestAssistant = messages
      .toReversed()
      .find((candidate) => candidate.role === "assistant");
    if (!latestAssistant || spokenMessageIdRef.current === latestAssistant.id) {
      return;
    }
    const spokenText = assistantSpeech(latestAssistant.parts);
    if (!spokenText || typeof window === "undefined" || !window.speechSynthesis) {
      awaitingVoiceReplyRef.current = false;
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = navigator.language || "en-GB";
    utterance.rate = 1.02;
    window.speechSynthesis.speak(utterance);
    spokenMessageIdRef.current = latestAssistant.id;
    awaitingVoiceReplyRef.current = false;
  }, [error, isRunning, messages]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    },
    [],
  );

  function startTesting() {
    const prompt = message.trim();
    if (!prompt || isRunning) return;
    if (recognitionRef.current) {
      voiceCanceledRef.current = true;
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setIsListening(false);
    }
    awaitingVoiceReplyRef.current = false;
    window.speechSynthesis?.cancel();
    setMessage("");
    void sendMessage({ text: prompt });
  }

  function toggleVoiceInput() {
    if (isRunning) return;
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      setVoiceNotice("Voice input isn't supported in this browser.");
      return;
    }

    window.speechSynthesis?.cancel();
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-GB";
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    voiceBaseRef.current = message.trim();
    voiceFinalRef.current = "";
    voiceLatestRef.current = message.trim();
    voiceHeardRef.current = false;
    voiceCanceledRef.current = false;
    setVoiceNotice("Starting microphone…");

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceNotice("Listening… pause when you're ready to send");
    };
    recognition.onresult = (event) => {
      voiceHeardRef.current = true;
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) voiceFinalRef.current += ` ${transcript}`;
        else interim += ` ${transcript}`;
      }

      const spoken = `${voiceFinalRef.current} ${interim}`.trim();
      const combined = [voiceBaseRef.current, spoken]
        .filter(Boolean)
        .join(" ")
        .trim();
      voiceLatestRef.current = combined;
      setMessage(combined);
    };
    recognition.onerror = (event) => {
      voiceCanceledRef.current = true;
      if (event.error !== "aborted") {
        setVoiceNotice(voiceErrorMessage(event.error));
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      const prompt = voiceLatestRef.current.trim();
      if (voiceCanceledRef.current) return;
      if (!voiceHeardRef.current || !prompt) {
        setVoiceNotice("No speech captured. Tap the microphone to try again.");
        return;
      }

      setVoiceNotice("Voice message sent");
      setMessage("");
      awaitingVoiceReplyRef.current = true;
      void sendMessage({ text: prompt });
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setVoiceNotice("The microphone is already in use. Please try again.");
    }
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
            trinetra
          </span>
        </h1>

        {hasMessages && (
          <div
            className="agent-thread"
            aria-label="Conversation with trinetra"
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
            aria-label="Message to trinetra"
            placeholder="Type a message..."
            value={message}
            onChange={(event) => {
              if (recognitionRef.current) {
                voiceCanceledRef.current = true;
                recognitionRef.current.abort();
                recognitionRef.current = null;
                setIsListening(false);
                setVoiceNotice("");
              }
              setMessage(event.target.value);
            }}
            onKeyDown={handleKeyDown}
          />
          <p
            className={isListening ? "voice-listening" : undefined}
            role={voiceNotice ? "status" : undefined}
          >
            {voiceNotice || "Press Enter to send, Shift+Enter for new line"}
          </p>
          <div className="agent-composer-actions">
            <button
              type="button"
              className={`agent-voice${isListening ? " listening" : ""}`}
              aria-label={isListening ? "Stop listening and send" : "Start voice mode"}
              aria-pressed={isListening}
              disabled={isRunning}
              onClick={toggleVoiceInput}
            >
              {isListening ? <Square size={16} fill="currentColor" /> : <Mic size={19} />}
            </button>
            <button
              type="button"
              className="agent-send"
              disabled={isRunning || !message.trim()}
              onClick={startTesting}
            >
              <Send size={18} />
              {isRunning ? "Thinking" : "Send"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
