import type { CompleteTenderMetadata } from "./extractCompleteMetadata.js";
import {
  evaluateTender247ItRelevance,
  type ItRelevanceClassifierCallTracker,
  type Tender247ItRelevanceResult,
} from "../prescreen/tender247ItRelevanceClassifier.js";

/**
 * Build multi-field classification corpus from Tender247 detail metadata
 * (before document download).
 */
export function buildTender247ItRelevanceCorpus(
  metadata: CompleteTenderMetadata,
): { combined: string; evidenceFields: string[]; fieldTexts: Record<string, string> } {
  const fieldTexts: Record<string, string> = {};
  const n = metadata.normalized ?? {};
  const overview = metadata.tenderOverview ?? {};
  const ai = metadata.aiSummary ?? {};

  const add = (field: string, value: unknown): void => {
    if (value === null || value === undefined) return;
    const text = String(value).replace(/\s+/g, " ").trim();
    if (!text) return;
    fieldTexts[field] = fieldTexts[field]
      ? `${fieldTexts[field]} ${text}`
      : text;
  };

  add("title", n.tenderName);
  add("title", n.brief);
  add("category", n.category);
  add("description", n.description);
  add("brief", n.brief);

  for (const [key, value] of Object.entries(overview)) {
    const lower = key.toLowerCase();
    if (/tender\s*type|type\s*of\s*tender/i.test(key)) {
      add("tenderType", value);
    } else if (/categor/i.test(key)) {
      add("category", value);
    } else if (/brief|title|name|work/i.test(key)) {
      add("title", value);
    } else if (/description|scope|summary|detail/i.test(key)) {
      add("description", value);
    } else if (/product|service|item/i.test(lower)) {
      add("scope", value);
    } else {
      add("overview", value);
    }
  }

  // AI summary DOM text — available without downloading PDF
  for (const [key, value] of Object.entries(ai)) {
    if (/summary|scope|description|brief|objective|deliverable/i.test(key)) {
      add("aiSummary", value);
    } else {
      add("aiSummaryOther", value);
    }
  }

  const evidenceFields = Object.keys(fieldTexts);
  const combined = Object.values(fieldTexts).join(" \n ").trim();
  return { combined, evidenceFields, fieldTexts };
}

export function evaluateTender247ItRelevanceFromMetadata(
  metadata: CompleteTenderMetadata,
  tracker?: ItRelevanceClassifierCallTracker,
): Tender247ItRelevanceResult {
  const corpus = buildTender247ItRelevanceCorpus(metadata);
  return evaluateTender247ItRelevance(corpus.combined, {
    evidenceFields: corpus.evidenceFields.length
      ? corpus.evidenceFields
      : ["combined"],
    tracker,
  });
}
