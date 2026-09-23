import type { AskAiSource } from "@/lib/ai/ask-ai-stream";
import type { AskAiPhase } from "@/lib/ai/ask-ai-client";
import {
  ASK_AI_QUICK_ACTIONS,
  type AskAiQuickActionDef,
} from "@/lib/ai/ask-ai-actions";

export type AskAiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  statusText?: string;
  warnings?: string[];
  sources?: AskAiSource[];
  incomplete?: boolean;
  error?: boolean;
  cancelled?: boolean;
  /** Show Retry Indexing control after on-demand index failure. */
  indexFailed?: boolean;
  /** True when tender has no indexable documents — do not offer Retry Indexing. */
  noDocuments?: boolean;
};

/** UI quick-action chip (structured `action` + display message). */
export type AskAiQuickAction = AskAiQuickActionDef;

export { ASK_AI_QUICK_ACTIONS };

export type { AskAiPhase };

export function isIndexNotReadyWarning(warnings?: string[]): boolean {
  if (!warnings?.length) return false;
  const text = warnings.join(" ").toLowerCase();
  // No-documents is a terminal informational state — not a reindex prompt.
  if (
    text.includes("no tender documents are available to index") ||
    text.includes("no documents")
  ) {
    return false;
  }
  return (
    text.includes("not been indexed") ||
    text.includes("not indexed yet") ||
    text.includes("ai knowledge for this tender has not") ||
    text.includes("could not prepare ai knowledge") ||
    text.includes("retry indexing")
  );
}

export function humanizeAskAiWarning(warning: string): string {
  const lower = warning.toLowerCase();
  if (
    lower.includes("no tender documents are available to index") ||
    lower.includes("no documents are available")
  ) {
    return "No tender documents are available to index for this tender yet.";
  }
  if (
    lower.includes("preparing ai knowledge") ||
    lower.includes("required only once")
  ) {
    return "Preparing AI knowledge for this tender. This is required only once.";
  }
  if (
    lower.includes("could not prepare ai knowledge") ||
    lower.includes("no tender documents are available to index") ||
    (lower.includes("timed out") && lower.includes("indexing"))
  ) {
    return warning;
  }
  if (
    lower.includes("not been indexed") ||
    lower.includes("not indexed yet") ||
    lower.includes("ai knowledge for this tender has not")
  ) {
    return "Preparing AI knowledge for this tender. This is required only once.";
  }
  if (lower.includes("incomplete") || lower.includes("not fully indexed")) {
    return "Some tender documents are not fully indexed yet. Analysis may be incomplete.";
  }
  if (
    lower.includes("not sufficiently represented") ||
    lower.includes("verify the full rfp")
  ) {
    return "Some indexed tender sections were not fully covered. Verify the full RFP before submission.";
  }
  if (lower.includes("no sufficiently relevant")) {
    return "No sufficiently relevant indexed evidence was found for this question.";
  }
  if (lower.includes("unknown citation")) {
    return "Some citation references could not be matched to sources.";
  }
  return warning;
}
