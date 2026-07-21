"use server";

import { auth, tasks } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import type { visualReportTask } from "@/trigger/visual-report";

export const startChatSession =
  chat.createStartSessionAction("trinetra-agent");

export async function mintChatAccessToken(chatId: string) {
  return auth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  });
}

export async function startVisualReport(input: {
  query: string;
  email?: string;
}) {
  const query = input.query.trim();
  const email = input.email?.trim() || undefined;

  if (!query) throw new Error("A report query is required.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  const handle = await tasks.trigger<typeof visualReportTask>(
    "visual-report",
    { query, email },
    undefined,
    { publicAccessToken: { expirationTime: "1h" } },
  );

  return {
    runId: handle.id,
    accessToken: handle.publicAccessToken,
  };
}
