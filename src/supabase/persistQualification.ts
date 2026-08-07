import type { QualificationResult } from "../chatgptQualification/types.js";
import {
  upsertQualificationResult,
  type QualificationStatus,
} from "./qualificationResultStore.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "./client.js";
import {
  buildFinancialFactsEnrichment,
  readFinancialFacts,
} from "./financialFactsFallback.js";

export async function persistValidatedQualificationToSupabase(options: {
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  qualification: QualificationResult;
  rawResponse: string;
  chatUrl: string | null;
  logger?: { info: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };
}): Promise<{ ok: boolean; error: string | null }> {
  const {
    sourcePortal,
    sourceTenderId,
    qualification,
    rawResponse,
    chatUrl,
    logger,
  } = options;

  const result = await upsertQualificationResult({
    sourcePortal,
    sourceTenderId,
    status: qualification.status as QualificationStatus,
    decisionLabel: qualification.decisionLabel,
    verdict: qualification.verdict,
    reason: qualification.reason,
    requiredAction: qualification.requiredAction || null,
    confidence: Number(qualification.confidence) || 0,
    matchedCriteria: qualification.matchedCriteria,
    failedCriteria: qualification.failedCriteria,
    unclearCriteria: qualification.unclearCriteria,
    missingDocuments: qualification.missingDocuments,
    conditions: qualification.conditions,
    partnershipRequiredFor: qualification.partnershipRequiredFor,
    partnershipModeAllowed: qualification.partnershipModeAllowed,
    manualReviewRequired: qualification.manualReviewRequired,
    requiresDetailedTenderReview: Boolean(
      qualification.requiresDetailedTenderReview,
    ),
    evidenceFiles: qualification.evidenceFiles || [],
    rawResponse,
    rawResult: qualification as unknown as Record<string, unknown>,
    chatUrl,
    promptVersion: "phase1-v2",
    modelName: null,
  });

  if (!result.ok) {
    logger?.error?.(
      `SUPABASE_QUALIFICATION_UPSERT_FAILED=${result.error}`,
    );
    return { ok: false, error: result.error };
  }

  // Optional null-only enrichment from structured financialFacts (never free-text scrape).
  await maybeEnrichTenderFinancialsFromQualification({
    sourcePortal,
    sourceTenderId,
    qualification: qualification as unknown as Record<string, unknown>,
    logger,
  });

  return { ok: true, error: null };
}

async function maybeEnrichTenderFinancialsFromQualification(options: {
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  qualification: Record<string, unknown>;
  logger?: { info: (msg: string) => void; warn?: (msg: string) => void };
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const facts = readFinancialFacts(options.qualification);
  if (!facts) return;

  try {
    const client = getSupabaseAdminClient();
    const { data: row, error } = await client
      .from("agenttender_tenders")
      .select("id, tender_value, tender_value_text, emd_amount, emd_text")
      .eq("source_portal", options.sourcePortal)
      .eq("source_tender_id", options.sourceTenderId)
      .maybeSingle();

    if (error || !row) return;

    const patch = buildFinancialFactsEnrichment({
      existingTenderValue: row.tender_value as number | null,
      existingEmdAmount: row.emd_amount as number | null,
      existingTenderValueText: row.tender_value_text as string | null,
      existingEmdText: row.emd_text as string | null,
      financialFacts: facts,
    });

    if (Object.keys(patch).length === 0) return;

    const { error: updateError } = await client
      .from("agenttender_tenders")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (updateError) {
      options.logger?.warn?.(
        `FINANCIAL_FACTS_FALLBACK_FAILED=${updateError.message}`,
      );
      return;
    }
    options.logger?.info?.(
      `FINANCIAL_FACTS_FALLBACK_APPLIED=${options.sourcePortal}:${options.sourceTenderId} fields=${Object.keys(patch).join(",")}`,
    );
  } catch (error) {
    options.logger?.warn?.(
      `FINANCIAL_FACTS_FALLBACK_FAILED=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
