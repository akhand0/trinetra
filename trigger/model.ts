import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

export const DEFAULT_TRINETRA_MODEL = "google/gemma-4-31b-it:free";

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

/** Native Anthropic provider, used when TRINETRA_MODEL names a Claude model. */
export const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function selectedModel() {
  return process.env.TRINETRA_MODEL ?? DEFAULT_TRINETRA_MODEL;
}

/** A Claude model is served by the native Anthropic API, not OpenRouter. */
function isAnthropicModel(model: string) {
  return model.startsWith("claude-") || model.startsWith("anthropic/");
}

export function trinetraModel() {
  const model = selectedModel();
  if (isAnthropicModel(model)) {
    return anthropic(model.replace(/^anthropic\//, ""));
  }
  return openrouter.chat(model);
}

/**
 * Moonshot's thinking mode rejects an explicitly named tool choice. Keep the
 * Kimi compatibility override for deployments that explicitly select a
 * Moonshot model; Gemma, Claude, and other models use native tool calling.
 */
export function forcedToolProviderOptions() {
  const model = selectedModel();
  return model.startsWith("moonshotai/kimi-")
    ? { openai: { reasoningEffort: "none" as const } }
    : undefined;
}
