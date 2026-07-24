import { createAnthropic } from "@ai-sdk/anthropic";

/** Trinetra runs on Anthropic Claude only. */
export const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const DEFAULT_TRINETRA_MODEL = "claude-sonnet-5";

export function trinetraModel() {
  return anthropic(process.env.TRINETRA_MODEL ?? DEFAULT_TRINETRA_MODEL);
}
