/**
 * Bid Workspace AI instruction templates (editable) vs runtime context (server-injected).
 * Defaults must stay in sync with generation/ingestion code paths.
 */

export const BID_AI_PROMPT_KEYS = [
  "CHECKLIST_CREATION",
  "PREQUAL_DOCUMENT",
  "TECHNICAL_DOCUMENT",
  "ANNEXURE_DOCUMENT",
  "COST_ESTIMATOR",
  "CHECKLIST_ITEM_DOCUMENT",
] as const;

export type BidAiPromptKey = (typeof BID_AI_PROMPT_KEYS)[number];

export type BidAiPromptMeta = {
  key: BidAiPromptKey;
  label: string;
  description: string;
  defaultTemplate: string;
  maxLength: number;
};

/** Instruction templates only — tender/RFP bytes are injected server-side. */
export const BID_AI_PROMPT_CATALOG: Record<BidAiPromptKey, BidAiPromptMeta> = {
  CHECKLIST_CREATION: {
    key: "CHECKLIST_CREATION",
    label: "Checklist Creation",
    description:
      "Used when running Use AI on Checklist Creation to extract requirements from the tender package.",
    maxLength: 12_000,
    defaultTemplate: `You extract tender bid submission requirements from a COMPLETE tender package (RFP/NIT/BOQ/HTML/annexures).

Return ONLY JSON matching:
{
  "checklist": [{ "requirement_key", "requirement_name", "category", "description", "mandatory", "document_type", "generation_allowed", "source_page", "source_clause", "source_text", "source_document" }],
  "annexures": [{ "title", "description", "format_hint", "mandatory" }],
  "cost_items": [{ "description", "detail", "uom", "quantity", "unit_rate", "category" }],
  "summary": "string",
  "analysis_status": "OK"
}

Rules:
- Extract REAL submission requirements (GST, PAN, experience, EMD, technical approach, integrity pact, etc.).
- NEVER create checklist items from opaque numeric filenames like 210636747 / 210636748 / 210636750.
- Source filenames are documents, not requirements.
- Reconcile across ALL attached files into one package checklist.
- Categories: COMPLIANCE, TECHNICAL, FINANCIAL, LEGAL, EXPERIENCE, ANNEXURE, DECLARATION, AUTHORIZATION, CERTIFICATE, EMD, BOQ, PRE_QUALIFICATION.
- generation_allowed=true only for narrative drafts (approach, plan, cover letter, declarations). Never for GST/PAN/ISO/CMMI certificates.
- Prefer requirement_key values like GST_REGISTRATION, TECHNICAL_APPROACH, INTEGRITY_PACT.
- Set source_document to the real source file name when known.`,
  },
  PREQUAL_DOCUMENT: {
    key: "PREQUAL_DOCUMENT",
    label: "Pre-Qualification Documents",
    description:
      "Guidance used when generating pre-qualification narrative drafts from checklist items.",
    maxLength: 8_000,
    defaultTemplate: `Prepare professional pre-qualification / eligibility response documents for this tender.
Use only supplied RFP evidence and company records.
Prefer clear structure, tender-specific wording, and explicit placeholders where company facts are missing.
Do not invent certifications, financials, or past projects.`,
  },
  TECHNICAL_DOCUMENT: {
    key: "TECHNICAL_DOCUMENT",
    label: "Technical Documents",
    description:
      "Guidance used when generating technical checklist response documents.",
    maxLength: 8_000,
    defaultTemplate: `Prepare tender-specific technical response documents (approach, plans, mobilization, CV templates, compliance notes).
Use RFP terminology. Prefer concrete, requirement-aligned content over generic proposal filler.
Do not invent technologies, employees, or project experience not present in the supplied context.`,
  },
  ANNEXURE_DOCUMENT: {
    key: "ANNEXURE_DOCUMENT",
    label: "Annexures & Undertakings",
    description:
      "Guidance used when generating annexures, declarations, and undertakings.",
    maxLength: 8_000,
    defaultTemplate: `Prepare annexures, undertakings, and declarations that follow RFP wording closely.
Do not alter legal meaning. Mark signature, stamp, notarization, or authorized signatory as ACTION REQUIRED.
Keep status clearly draft where execution is still required.`,
  },
  COST_ESTIMATOR: {
    key: "COST_ESTIMATOR",
    label: "Cost Estimator",
    description:
      "Used when Use AI extracts BOQ / cost lines from the tender package (shares checklist ingestion with cost_items).",
    maxLength: 8_000,
    defaultTemplate: `When extracting cost items from the tender package, prefer structured BOQ rows with description, UOM, quantity, and unit rate when present.
Do not invent unit rates or quantities. If only lump-sum headings exist, create one line per clear cost head with quantity 1 and unit_rate null.`,
  },
  CHECKLIST_ITEM_DOCUMENT: {
    key: "CHECKLIST_ITEM_DOCUMENT",
    label: "Per-item document generation",
    description:
      "Shared instruction add-on when generating a single checklist item document (Generate with AI).",
    maxLength: 8_000,
    defaultTemplate: `Generate a professional tender response document for the stated checklist requirement.
Use only supplied RFP and company evidence. Prefer concrete, tender-specific wording.
Mark missing company inputs explicitly with placeholders.`,
  },
};

export function isBidAiPromptKey(value: string): value is BidAiPromptKey {
  return (BID_AI_PROMPT_KEYS as readonly string[]).includes(value);
}

export function promptKeyForWorkspaceTab(
  tab: "checklist" | "prequalification" | "technical" | "annexures" | "cost",
): BidAiPromptKey {
  switch (tab) {
    case "checklist":
      return "CHECKLIST_CREATION";
    case "prequalification":
      return "PREQUAL_DOCUMENT";
    case "technical":
      return "TECHNICAL_DOCUMENT";
    case "annexures":
      return "ANNEXURE_DOCUMENT";
    case "cost":
      return "COST_ESTIMATOR";
    default:
      return "CHECKLIST_CREATION";
  }
}

export function promptKeyForChecklistCategory(category: string): BidAiPromptKey {
  const c = category.toUpperCase();
  if (
    c === "ANNEXURE" ||
    c === "DECLARATION" ||
    c === "AUTHORIZATION" ||
    c === "LEGAL"
  ) {
    return "ANNEXURE_DOCUMENT";
  }
  if (
    c === "COMPLIANCE" ||
    c === "FINANCIAL" ||
    c === "EXPERIENCE" ||
    c === "CERTIFICATE" ||
    c === "EMD" ||
    c === "PRE_QUALIFICATION"
  ) {
    return "PREQUAL_DOCUMENT";
  }
  return "TECHNICAL_DOCUMENT";
}

export function sanitizePromptTemplate(
  value: string,
  maxLength: number,
): string {
  const trimmed = value.replace(/\r\n/g, "\n").trim();
  if (!trimmed) throw new Error("Prompt cannot be empty.");
  if (trimmed.length > maxLength) {
    throw new Error(`Prompt exceeds the ${maxLength} character limit.`);
  }
  return trimmed;
}
