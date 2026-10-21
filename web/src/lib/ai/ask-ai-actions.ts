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

export const ASK_AI_QUICK_ACTIONS: AskAiQuickActionDef[] = [
  {
    action: "ASSESS_TENDER",
    label: "Assess Tender",
    message:
      "Assess this tender for Siyana. Check the current tender scope, mandatory eligibility/PQ, EMD, turnover, similar experience, certifications/authorizations, manpower, hardware, licences/subscriptions, local-office requirements, AMC/support-only scope, and other owner NO_GO rules. Compare requirements with available company evidence and past verified/submitted/won evidence. Give a concise recommendation with Confirmed, Unverified, and Risk items. Do not change tender status.",
    statusText: "Assessing tender scope, PQ and company evidence...",
    primary: true,
  },
  {
    action: "CHECK_ELIGIBILITY",
    label: "Eligibility",
    message:
      "List every mandatory eligibility and pre-qualification criterion in this tender. For each criterion show: requirement, tender evidence, matching company evidence, and result as Confirmed / Not confirmed / Unverified. Include registrations, certifications, authorizations, empanelment, turnover, net worth/PBT if applicable, experience, and any bidder-specific conditions.",
    statusText: "Checking mandatory eligibility and PQ criteria...",
  },
  {
    action: "CHECK_TURNOVER",
    label: "Turnover",
    message:
      "What is the bidder turnover requirement in this tender? Check the exact period, threshold, exemptions/relaxations, and buyer-verification conditions. Compare it with the available Siyana financial evidence and state Confirmed / Not confirmed / Unverified with citations.",
    statusText: "Checking turnover and financial evidence...",
  },
  {
    action: "CHECK_SIMILAR_EXPERIENCE",
    label: "Similar Experience",
    message:
      "What similar-work or past-experience criteria are mandatory in this tender? Check years, project count, minimum values, sector/client restrictions, completion dates, 40%/50%/80% rules, and whether private-sector experience is accepted. Compare against Siyana's available won/submitted/company project evidence and identify the strongest matches.",
    statusText: "Checking similar-work criteria and matching projects...",
  },
  {
    action: "CHECK_REQUIRED_DOCUMENTS",
    label: "Required Documents",
    message:
      "List the mandatory bid documents and supporting evidence required by this tender. Group them as Company Document, Tender-specific Declaration/Undertaking, Technical Document, Financial/BOQ, and Manual Action. For each item, state whether matching Siyana evidence is available, missing, or unverified.",
    statusText: "Checking mandatory bid documents and available evidence...",
  },
  {
    action: "CHECK_EMD_MSME",
    label: "EMD / MSME",
    message:
      "Check the actual payable EMD/bid security in the tender documents, not only metadata. Also check MSE/MSME/startup exemptions or relaxations, required proof, PBG/performance security, and any conditions that limit the exemption. Compare with available Siyana MSME evidence and state the practical payable position.",
    statusText: "Checking EMD, PBG and MSME/startup clauses...",
  },
  {
    action: "CHECK_GOVERNMENT_EXPERIENCE",
    label: "Government Experience",
    message:
      "Does this tender require prior Government/PSU/University/Autonomous-body experience, or is private-sector experience acceptable? Quote the exact requirement and compare it with Siyana's available government and submitted-project evidence. State whether this criterion is Confirmed / Not confirmed / Unverified.",
    statusText: "Checking government/PSU experience requirements...",
  },
  {
    action: "IDENTIFY_RISKS",
    label: "Risks",
    message:
      "Identify the main bid risks and possible NO_GO conditions in this tender. Specifically check mandatory manpower/resource deployment, hardware/device procurement, third-party software licences/subscriptions, ready-made/COTS software, standalone AMC/hosting/support, cyber-security-only scope, kiosk, local office, proprietary/OEM authorization, empanelment, high EMD, and mandatory PQ gaps. Separate confirmed risks from unverified risks.",
    statusText: "Checking tender risks and NO_GO conditions...",
  },
  {
    action: "SUMMARIZE_TENDER",
    label: "Summarize",
    message:
      "Summarize this tender for bid decision-making. Include buyer, scope, contract period, closing date, tender value, actual EMD/PBG if available, mandatory PQ, turnover, similar experience, key deliverables, manpower/hardware/licence requirements, required documents, major risks, and the most relevant Siyana company/past-project evidence. Clearly mark anything unverified.",
    statusText: "Preparing tender decision summary...",
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
  return getQuickActionById(action)?.statusText || "Checking tender evidence...";
}

/** Broad actions that benefit from broader V2 context retrieval. */
export function isBroadAskAiAction(action: AskAiAction): boolean {
  return (
    action === "ASSESS_TENDER" ||
    action === "SUMMARIZE_TENDER" ||
    action === "CHECK_ELIGIBILITY" ||
    action === "CHECK_REQUIRED_DOCUMENTS" ||
    action === "IDENTIFY_RISKS"
  );
}
