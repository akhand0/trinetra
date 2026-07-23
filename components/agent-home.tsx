"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import { Mic, MoreVertical, Send, Sparkles, Square } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FormEvent, KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { mintChatAccessToken, startChatSession } from "@/app/actions";
import {
  VisualResponse,
  VisualResponseGroup,
  type VisualPanelPayload,
} from "@/components/visual-response";
import {
  visibleSelectionActionText,
  type InvestigationAction,
  type InvestigationSelection,
} from "@/lib/telemetry/investigation-selection";
import { spokenFindingsFromParts } from "@/lib/telemetry/spoken-findings";
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

function subscribeToSpeechSupport() {
  return () => undefined;
}

function browserSupportsSpeech() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.speechSynthesis) &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

function serverSupportsSpeech() {
  return false;
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

export function AgentHome() {
  const [message, setMessage] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(
    null,
  );
  const threadEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceBaseRef = useRef("");
  const voiceFinalRef = useRef("");
  const voiceLatestRef = useRef("");
  const voiceHeardRef = useRef(false);
  const voiceCanceledRef = useRef(false);
  const awaitingVoiceReplyRef = useRef(false);
  const voiceReplyAfterIdRef = useRef<string | null>(null);
  const spokenMessageIdRef = useRef<string | null>(null);
  const selectionSubmissionRef = useRef(false);
  const previousMessageCountRef = useRef(0);
  const transport = useTriggerChatTransport<typeof trinetraAgent>({
    task: "trinetra-agent",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startChatSession({ chatId, clientData }),
  });
  const { error, messages, sendMessage, status } = useChat({ transport });
  const isRunning = status === "submitted" || status === "streaming";
  const hasMessages = messages.length > 0;
  const speechSupported = useSyncExternalStore(
    subscribeToSpeechSupport,
    browserSupportsSpeech,
    serverSupportsSpeech,
  );

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    setSpeakingMessageId(null);
  }, []);

  const speakFindings = useCallback((messageId: string, text: string) => {
    const spokenText = text.trim();
    if (
      !spokenText ||
      typeof window === "undefined" ||
      !window.speechSynthesis ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      return false;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = navigator.language || "en-GB";
    utterance.rate = 1.02;
    utterance.onstart = () => {
      if (utteranceRef.current === utterance) {
        setSpeakingMessageId(messageId);
      }
    };
    const finish = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setSpeakingMessageId(null);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    return true;
  }, []);

  function toggleSpokenFindings(messageId: string, text: string) {
    if (speakingMessageId === messageId) {
      stopSpeaking();
      return;
    }
    speakFindings(messageId, text);
  }

  useEffect(() => {
    if (!isRunning) selectionSubmissionRef.current = false;
  }, [isRunning]);

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;
    if (!hasMessages || messages.length === previousCount) return;
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [hasMessages, messages.length]);

  useEffect(() => {
    if (error) {
      awaitingVoiceReplyRef.current = false;
      voiceReplyAfterIdRef.current = null;
      return;
    }
    if (!awaitingVoiceReplyRef.current || isRunning) return;
    const latestAssistant = messages
      .toReversed()
      .find((candidate) => candidate.role === "assistant");
    if (
      !latestAssistant ||
      latestAssistant.id === voiceReplyAfterIdRef.current ||
      spokenMessageIdRef.current === latestAssistant.id
    ) {
      return;
    }
    const spokenText = spokenFindingsFromParts(latestAssistant.parts);
    if (!spokenText) {
      awaitingVoiceReplyRef.current = false;
      voiceReplyAfterIdRef.current = null;
      return;
    }
    if (!speechSupported) {
      awaitingVoiceReplyRef.current = false;
      voiceReplyAfterIdRef.current = null;
      return;
    }

    speakFindings(latestAssistant.id, spokenText);
    spokenMessageIdRef.current = latestAssistant.id;
    awaitingVoiceReplyRef.current = false;
    voiceReplyAfterIdRef.current = null;
  }, [error, isRunning, messages, speakFindings, speechSupported]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      utteranceRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const stopOnVisibilityChange = () => {
      if (document.hidden) stopSpeaking();
    };
    const stopOnPageHide = () => stopSpeaking();
    document.addEventListener("visibilitychange", stopOnVisibilityChange);
    window.addEventListener("pagehide", stopOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", stopOnVisibilityChange);
      window.removeEventListener("pagehide", stopOnPageHide);
    };
  }, [stopSpeaking]);

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
    voiceReplyAfterIdRef.current = null;
    stopSpeaking();
    setMessage("");
    void sendMessage({ text: prompt });
  }

  function investigateSelection(
    action: InvestigationAction,
    selection: InvestigationSelection,
    originalQuery: string,
  ) {
    if (isRunning || selectionSubmissionRef.current) return;
    selectionSubmissionRef.current = true;
    awaitingVoiceReplyRef.current = false;
    voiceReplyAfterIdRef.current = null;
    stopSpeaking();
    const text = visibleSelectionActionText(action, selection);
    void sendMessage({
      text,
      metadata: {
        followUp: {
          action,
          originalQuery,
          selection,
        },
      },
    }).catch(() => {
      selectionSubmissionRef.current = false;
    });
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

    stopSpeaking();
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
      voiceReplyAfterIdRef.current =
        messages.toReversed().find((candidate) => candidate.role === "assistant")
          ?.id ?? null;
      awaitingVoiceReplyRef.current = speechSupported;
      if (!speechSupported) {
        setVoiceNotice(
          "Voice message sent. Spoken replies aren't supported in this browser.",
        );
      }
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
                    const spokenText = spokenFindingsFromParts(
                      chatMessage.parts,
                    );
                    const previousUserPrompt = messages
                      .slice(0, messageIndex)
                      .toReversed()
                      .find((candidate) => candidate.role === "user")
                      ?.parts.find((candidate) => candidate.type === "text");
                    return (
                      <VisualResponseGroup
                        data={part.data}
                        query={previousUserPrompt?.text}
                        onInvestigate={investigateSelection}
                        disabled={isRunning}
                        speaking={speakingMessageId === chatMessage.id}
                        speechSupported={speechSupported}
                        onToggleSpeech={
                          spokenText
                            ? () =>
                                toggleSpokenFindings(
                                  chatMessage.id,
                                  spokenText,
                                )
                            : undefined
                        }
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
              if (speakingMessageId) stopSpeaking();
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
              aria-label={
                isListening
                  ? "Stop listening and send"
                  : "Start voice conversation; replies will be spoken"
              }
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
