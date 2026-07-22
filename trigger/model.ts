import { createOpenAI } from "@ai-sdk/openai";

/** OpenRouter exposes an OpenAI-compatible Chat Completions endpoint. */
export const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  headers: {
    ...(process.env.OPENROUTER_SITE_URL
      ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL }
      : {}),
    "X-Title": "Trinetra",
  },
});

export function trinetraModel() {
  return openrouter.chat(process.env.TRINETRA_MODEL ?? "moonshotai/kimi-k3");
}

/**
 * Moonshot's thinking mode rejects an explicitly named tool choice. Disable
 * thinking only for the deterministic routing steps that name a tool; Kimi's
 * data analysis and visual selection steps continue to use thinking mode.
 */
export function forcedToolProviderOptions() {
  const model = process.env.TRINETRA_MODEL ?? "moonshotai/kimi-k3";
  return model.startsWith("moonshotai/kimi-")
    ? { openai: { reasoningEffort: "none" as const } }
    : undefined;
}
