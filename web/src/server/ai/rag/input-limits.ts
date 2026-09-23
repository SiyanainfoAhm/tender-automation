/**
 * Phase 8 input validation / abuse protection for Ask AI.
 */
import "server-only";

import { countTokens } from "@/server/ai/rag/chunking";
import { getAskAiInputLimits } from "@/server/ai/rag/config";

export type AskAiConversationItem = {
  role: "user" | "assistant";
  content: string;
};

export type ValidatedAskAiInput = {
  message: string;
  conversation: AskAiConversationItem[];
};

export class AskAiValidationError extends Error {
  code = "BAD_REQUEST" as const;
  constructor(message: string) {
    super(message);
    this.name = "AskAiValidationError";
  }
}

export function validateAskAiInput(options: {
  message: unknown;
  conversation?: unknown;
}): ValidatedAskAiInput {
  const limits = getAskAiInputLimits();
  const message =
    typeof options.message === "string" ? options.message.trim() : "";
  if (!message) {
    throw new AskAiValidationError("A question is required.");
  }
  if (message.length > limits.maxQuestionChars) {
    throw new AskAiValidationError(
      `Question is too long. Keep it under ${limits.maxQuestionChars} characters.`,
    );
  }

  const raw = Array.isArray(options.conversation) ? options.conversation : [];
  const conversation: AskAiConversationItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.trim()
    ) {
      conversation.push({
        role,
        content: content.trim().slice(0, limits.maxQuestionChars),
      });
    }
  }

  // Keep newest messages within message + token budgets.
  const trimmed = conversation.slice(-limits.maxHistoryMessages);
  const kept: AskAiConversationItem[] = [];
  let tokens = 0;
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const item = trimmed[i]!;
    const cost = countTokens(item.content);
    if (kept.length > 0 && tokens + cost > limits.maxHistoryTokens) break;
    kept.unshift(item);
    tokens += cost;
  }

  return { message, conversation: kept };
}
