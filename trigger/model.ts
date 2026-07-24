import { createAnthropic } from "@ai-sdk/anthropic";
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

/** Native Anthropic provider, used when TRINETRA_MODEL names a Claude model. */
export const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function selectedModel() {
  return process.env.TRINETRA_MODEL ?? "moonshotai/kimi-k3";
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
 * Moonshot's thinking mode rejects an explicitly named tool choice. Disable
 * thinking only for the deterministic routing steps that name a tool; Kimi's
 * data analysis and visual selection steps continue to use thinking mode.
 */
export function forcedToolProviderOptions() {
  const model = selectedModel();
  return model.startsWith("moonshotai/kimi-")
    ? { openai: { reasoningEffort: "none" as const } }
    : undefined;
}
