import { safeParseVisualResponse } from "@/lib/telemetry/visual-response";

export const SPOKEN_FINDINGS_LIMIT = 700;

function cleanForSpeech(value: string) {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedSpeech(fragments: string[]) {
  const unique = fragments
    .map(cleanForSpeech)
    .filter(Boolean)
    .filter(
      (fragment, index, all) =>
        all.findIndex(
          (candidate) => candidate.toLowerCase() === fragment.toLowerCase(),
        ) === index,
    )
    .join(" ");
  if (unique.length <= SPOKEN_FINDINGS_LIMIT) return unique;

  const candidate = unique.slice(0, SPOKEN_FINDINGS_LIMIT - 1);
  const boundary = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("; "),
    candidate.lastIndexOf(" "),
  );
  return `${candidate.slice(0, Math.max(boundary, 1)).trimEnd()}.`;
}

export function spokenFindingsFromParts(parts: readonly unknown[]) {
  const visualFragments: string[] = [];
  const textFragments: string[] = [];

  for (const rawPart of parts) {
    const part = rawPart as { type?: string; text?: string; data?: unknown };
    if (part.type === "text" && part.text?.trim()) {
      textFragments.push(part.text);
      continue;
    }
    if (part.type === "data-visual-response") {
      const response = safeParseVisualResponse(part.data);
      if (!response) continue;
      visualFragments.push(response.verdict);
      response.panels.forEach((panel) => {
        if (panel.finding) {
          visualFragments.push(`${panel.title}. ${panel.finding}`);
        }
      });
      continue;
    }
    if (part.type === "data-panel") {
      const panel = part.data as
        | { title?: string; finding?: string }
        | undefined;
      if (panel?.finding) {
        visualFragments.push(
          panel.title ? `${panel.title}. ${panel.finding}` : panel.finding,
        );
      }
    }
  }

  return boundedSpeech(
    visualFragments.length > 0 ? visualFragments : textFragments,
  );
}
