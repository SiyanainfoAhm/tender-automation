/** Shared text cleanup for response polling (no Playwright). */
export function cleanAssistantAnswerTextForPoll(text: string): string {
  return text
    .replace(/\bWorked for\s+\d+[hm]?(?:\s*\d+[sm])?\b/gi, "")
    .replace(/\bShow (more|less)\b/gi, "")
    .replace(/\bThinking(?:\s+for\s+[\d.]+s)?\b/gi, "")
    .replace(/\bSearching\b/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
