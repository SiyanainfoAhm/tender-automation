import type { QualificationResult } from "../chatgptQualification/types.js";
import {
  upsertQualificationResult,
  type QualificationStatus,
} from "./qualificationResultStore.js";

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
  return { ok: true, error: null };
}
