import "server-only";

import type { AskAiAction } from "@/lib/ai/ask-ai-stream";
import { isBroadAskAiAction } from "@/lib/ai/ask-ai-actions";

/**
 * Targeted retrieval query strings for multi-query actions.
 * Embeddings are batched once; each query reuses the same hybrid search.
 */
export function buildActionRetrievalQueries(options: {
  action: AskAiAction;
  question: string;
}): string[] {
  const { action, question } = options;

  if (!isBroadAskAiAction(action)) {
    const hints = ACTION_RETRIEVAL_HINTS[action] || [];
    if (hints.length === 0) return [question];
    // Single enriched query for focused actions (hints also flow into FTS).
    return [`${question} ${hints.slice(0, 8).join(" ")}`.trim()];
  }

  const byAction: Partial<Record<AskAiAction, string[]>> = {
    ASSESS_TENDER: [
      "eligibility qualification mandatory minimum criteria technical financial",
      "turnover average annual turnover financial capacity CA certificate audited",
      "similar experience similar work work order completion certificate project value",
      "EMD earnest money bid security MSME MSE startup exemption bank guarantee",
      "technical requirements certifications manpower scope of work",
      "mandatory documents submission checklist affidavit annexure forms",
    ],
    CHECK_ELIGIBILITY: [
      "eligibility technical qualification financial qualification mandatory criteria",
      "turnover average annual turnover financial capacity",
      "similar experience work order completion certificate",
      "certifications registration mandatory documents",
    ],
    CHECK_REQUIRED_DOCUMENTS: [
      "mandatory documents certificates annexure forms declarations affidavit",
      "registration GST PAN MSME supporting documents checklist",
      "EMD bank guarantee bid security submission documents",
      "work order completion certificate financial statements CA certificate",
    ],
    SUMMARIZE_TENDER: [
      "scope of work authority organization tender title estimated value",
      "closing date submission deadline important dates EMD",
      "eligibility turnover similar experience technical requirements",
      "mandatory documents contractual obligations payment terms",
    ],
    IDENTIFY_RISKS: [
      "eligibility disqualification mandatory criteria rejection",
      "EMD performance bank guarantee liquidated damages penalty SLA",
      "timeline closing date submission deadline completion period",
      "technical scope manpower commercial payment terms compliance",
    ],
  };

  const targeted = byAction[action] || [question];
  // Cap at 5 total (question + up to 4 targeted) for latency/cost control.
  const merged = [question, ...targeted].slice(0, 5);
  return Array.from(new Set(merged.map((q) => q.trim()).filter(Boolean)));
}

export const ACTION_RETRIEVAL_HINTS: Record<AskAiAction, string[]> = {
  GENERAL: [],
  ASSESS_TENDER: [
    "eligibility",
    "qualification",
    "turnover",
    "similar experience",
    "EMD",
    "MSME",
    "mandatory",
    "technical",
    "financial",
    "documents",
    "risk",
  ],
  CHECK_ELIGIBILITY: [
    "eligibility",
    "qualification",
    "technical qualification",
    "financial qualification",
    "mandatory",
    "minimum criteria",
  ],
  CHECK_SIMILAR_EXPERIENCE: [
    "similar work",
    "similar experience",
    "work order",
    "completion certificate",
    "project value",
    "government",
    "PSU",
    "executed",
    "completed",
  ],
  CHECK_TURNOVER: [
    "turnover",
    "average annual turnover",
    "financial eligibility",
    "CA certificate",
    "audited statements",
    "financial capacity",
  ],
  CHECK_GOVERNMENT_EXPERIENCE: [
    "government",
    "PSU",
    "ULB",
    "municipality",
    "corporation",
    "department",
    "public sector",
  ],
  CHECK_REQUIRED_DOCUMENTS: [
    "mandatory documents",
    "certificates",
    "annexure",
    "forms",
    "declarations",
    "affidavit",
    "registration",
    "supporting documents",
  ],
  CHECK_EMD_MSME: [
    "EMD",
    "earnest money",
    "bid security",
    "exemption",
    "MSME",
    "MSE",
    "startup",
    "bank guarantee",
    "DD",
  ],
  IDENTIFY_RISKS: [
    "risk",
    "penalty",
    "liquidated damages",
    "SLA",
    "scope",
    "mandatory",
    "disqualification",
    "PBG",
    "timeline",
  ],
  SUMMARIZE_TENDER: [
    "scope",
    "eligibility",
    "closing date",
    "EMD",
    "turnover",
    "experience",
    "submission",
    "authority",
    "value",
  ],
};
