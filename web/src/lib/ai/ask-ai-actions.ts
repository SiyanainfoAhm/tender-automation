/**
 * Client-safe Ask AI quick-action catalog.
 * Structured `action` IDs are sent separately from display messages.
 */

import type { AskAiAction } from "@/lib/ai/ask-ai-stream";

export type AskAiQuickActionDef = {
  action: Exclude<AskAiAction, "GENERAL">;
  label: string;
  /** Human-readable chat bubble text. */
  message: string;
  /** Short truthful status while retrieving. */
  statusText: string;
  primary?: boolean;
};

/** Suggested prominence order for Phase 7. */
export const ASK_AI_QUICK_ACTIONS: AskAiQuickActionDef[] = [
  {
    action: "ASSESS_TENDER",
    label: "Assess Tender",
    message:
      "Assess this tender against our available company evidence.",
    statusText: "Checking tender requirements and company evidence...",
    primary: true,
  },
  {
    action: "CHECK_ELIGIBILITY",
    label: "Eligibility",
    message:
      "Check the eligibility requirements and how our available evidence compares.",
    statusText: "Checking eligibility requirements...",
  },
  {
    action: "CHECK_TURNOVER",
    label: "Turnover",
    message:
      "Check the turnover requirement and whether our available evidence meets it.",
    statusText: "Checking financial eligibility...",
  },
  {
    action: "CHECK_SIMILAR_EXPERIENCE",
    label: "Similar Experience",
    message:
      "Check the similar experience requirement and matching company projects.",
    statusText: "Checking similar experience requirements...",
  },
  {
    action: "CHECK_REQUIRED_DOCUMENTS",
    label: "Required Documents",
    message:
      "List the required documents and whether we have supporting evidence.",
    statusText: "Checking required documents...",
  },
  {
    action: "CHECK_EMD_MSME",
    label: "EMD / MSME",
    message:
      "Check the EMD requirement and any MSME/MSE/startup exemptions.",
    statusText: "Checking EMD and exemption clauses...",
  },
  {
    action: "CHECK_GOVERNMENT_EXPERIENCE",
    label: "Government Experience",
    message:
      "Check whether government or PSU experience is required and how our evidence compares.",
    statusText: "Checking government experience requirements...",
  },
  {
    action: "IDENTIFY_RISKS",
    label: "Risks",
    message:
      "Identify evidence-backed risks in this tender for our bid preparation.",
    statusText: "Identifying tender risks...",
  },
  {
    action: "SUMMARIZE_TENDER",
    label: "Summarize",
    message: "Summarize this tender using the indexed documents.",
    statusText: "Summarizing indexed tender evidence...",
  },
];

const ACTION_SET = new Set<string>([
  "GENERAL",
  "ASSESS_TENDER",
  "CHECK_ELIGIBILITY",
  "CHECK_SIMILAR_EXPERIENCE",
  "CHECK_TURNOVER",
  "CHECK_GOVERNMENT_EXPERIENCE",
  "CHECK_REQUIRED_DOCUMENTS",
  "CHECK_EMD_MSME",
  "IDENTIFY_RISKS",
  "SUMMARIZE_TENDER",
]);

export function isAskAiAction(value: string): value is AskAiAction {
  return ACTION_SET.has(value);
}

export function normalizeAskAiActionId(
  value?: string | null,
): AskAiAction | null {
  if (!value) return null;
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return isAskAiAction(key) ? key : null;
}

export function getQuickActionById(
  action: AskAiAction,
): AskAiQuickActionDef | undefined {
  return ASK_AI_QUICK_ACTIONS.find((item) => item.action === action);
}

export function actionStatusText(action: AskAiAction): string {
  return (
    getQuickActionById(action)?.statusText ||
    "Searching indexed evidence..."
  );
}

/** Broad actions that benefit from multi-query retrieval (max 6). */
export function isBroadAskAiAction(action: AskAiAction): boolean {
  return (
    action === "ASSESS_TENDER" ||
    action === "SUMMARIZE_TENDER" ||
    action === "CHECK_ELIGIBILITY" ||
    action === "CHECK_REQUIRED_DOCUMENTS" ||
    action === "IDENTIFY_RISKS"
  );
}
