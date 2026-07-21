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
  return openrouter.chat(process.env.TRINETRA_MODEL ?? "openai/gpt-4o");
}
