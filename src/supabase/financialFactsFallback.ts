/**
 * Safe ChatGPT financialFacts fallback — never overwrites existing amounts,
 * never scrapes free-text reason/verdict/raw_response.
 */

export type StructuredFinancialFact = {
  amountInr?: number | null;
  sourceText?: string | null;
  evidenceFile?: string | null;
  confidence?: string | null;
};

export type FinancialFactsPayload = {
  tenderValue?: StructuredFinancialFact | null;
  emd?: StructuredFinancialFact | null;
};

function isHighConfidence(value: unknown): boolean {
  return String(value || "")
    .trim()
    .toLowerCase() === "high";
}

function isUsableFact(fact: StructuredFinancialFact | null | undefined): fact is StructuredFinancialFact {
  if (!fact || typeof fact !== "object") return false;
  if (!isHighConfidence(fact.confidence)) return false;
  if (typeof fact.amountInr !== "number" || !Number.isFinite(fact.amountInr) || fact.amountInr < 0) {
    return false;
  }
  const evidence = String(fact.evidenceFile || "").trim();
  if (!evidence) return false;
  return true;
}

/** Read structured financialFacts from a qualification JSON object if present. */
export function readFinancialFacts(
  qualification: Record<string, unknown> | null | undefined,
): FinancialFactsPayload | null {
  if (!qualification || typeof qualification !== "object") return null;
  const raw = qualification.financialFacts;
  if (!raw || typeof raw !== "object") return null;
  return raw as FinancialFactsPayload;
}

/**
 * Propose null-only enrichment for tender financial columns.
 * Returns patch fields only when existing values are null and facts are high-confidence.
 */
export function buildFinancialFactsEnrichment(options: {
  existingTenderValue: number | null | undefined;
  existingEmdAmount: number | null | undefined;
  existingTenderValueText?: string | null;
  existingEmdText?: string | null;
  financialFacts: FinancialFactsPayload | null;
}): {
  tender_value?: number;
  tender_value_text?: string | null;
  emd_amount?: number;
  emd_text?: string | null;
} {
  const patch: {
    tender_value?: number;
    tender_value_text?: string | null;
    emd_amount?: number;
    emd_text?: string | null;
  } = {};

  const facts = options.financialFacts;
  if (!facts) return patch;

  if (
    (options.existingTenderValue == null ||
      !Number.isFinite(options.existingTenderValue)) &&
    isUsableFact(facts.tenderValue)
  ) {
    patch.tender_value = facts.tenderValue.amountInr!;
    patch.tender_value_text =
      facts.tenderValue.sourceText?.trim() ||
      options.existingTenderValueText ||
      null;
  }

  if (
    (options.existingEmdAmount == null ||
      !Number.isFinite(options.existingEmdAmount)) &&
    isUsableFact(facts.emd)
  ) {
    patch.emd_amount = facts.emd.amountInr!;
    patch.emd_text =
      facts.emd.sourceText?.trim() || options.existingEmdText || null;
  }

  return patch;
}
