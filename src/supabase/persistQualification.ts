import type { QualificationResult } from "../chatgptQualification/types.js";
import {
  TENDER_DECISION_LABELS,
  TENDER_DECISION_REQUIRED_ACTIONS,
} from "../chatgptQualification/types.js";
import {
  upsertQualificationResult,
  type QualificationStatus,
} from "./qualificationResultStore.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "./client.js";
import {
  buildFinancialFactsEnrichment,
  readFinancialFacts,
} from "./financialFactsFallback.js";

/**
 * ChatGPT Phase-2 persist policy:
 * - GO / WILL_BID → store CONDITIONAL_GO (May Bid). Will Bid is manual-only.
 * - NO_GO / NO_BID → store VERIFY so humans review instead of auto No Bid
 *
 * Local qualification-result.json still keeps the model’s original status.
 * Phase-1 Excel screening writes through persistPhase1Results (same GO remap).
 */
export function agentQualificationStatusForDatabase(
  agentStatus: string | null | undefined,
  existingStatus?: string | null,
): string {
  if (String(existingStatus || "").trim().toUpperCase() === "GO") {
    return "GO";
  }
  const key = String(agentStatus || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (key === "GO" || key === "WILL_BID") {
    return "CONDITIONAL_GO";
  }
  return String(agentStatus || "");
}

export function qualificationStatusForSupabasePersist(
  qualification: QualificationResult,
): {
  status: QualificationStatus;
  decisionLabel: string;
  reason: string;
  requiredAction: string;
  unclearCriteria: string[];
  manualReviewRequired: boolean;
  remappedFromNoBid: boolean;
  remappedFromWillBid: boolean;
  rawResult: Record<string, unknown>;
} {
  const originalStatus = qualification.status;
  const remappedFromNoBid = originalStatus === "NO_GO";
  const remappedFromWillBid = originalStatus === "GO";

  if (remappedFromWillBid) {
    const reasonPrefix =
      "ChatGPT returned Will Bid; stored as May Bid until Will Bid is set manually. ";
    const reason = qualification.reason.trim().startsWith(reasonPrefix.trim())
      ? qualification.reason
      : `${reasonPrefix}${qualification.reason}`.trim();
    return {
      status: "CONDITIONAL_GO",
      decisionLabel: TENDER_DECISION_LABELS.CONDITIONAL_GO,
      reason,
      requiredAction:
        qualification.requiredAction?.trim() ||
        TENDER_DECISION_REQUIRED_ACTIONS.CONDITIONAL_GO,
      unclearCriteria: qualification.unclearCriteria,
      manualReviewRequired: true,
      remappedFromNoBid: false,
      remappedFromWillBid: true,
      rawResult: {
        ...(qualification as unknown as Record<string, unknown>),
        status: "CONDITIONAL_GO",
        decisionLabel: TENDER_DECISION_LABELS.CONDITIONAL_GO,
        reason,
        requiredAction:
          qualification.requiredAction?.trim() ||
          TENDER_DECISION_REQUIRED_ACTIONS.CONDITIONAL_GO,
        manualReviewRequired: true,
        chatgptOriginalStatus: originalStatus,
        supabaseStatusRemap: "GO_TO_CONDITIONAL_GO",
      },
    };
  }

  if (!remappedFromNoBid) {
    return {
      status: originalStatus as QualificationStatus,
      decisionLabel: qualification.decisionLabel,
      reason: qualification.reason,
      requiredAction: qualification.requiredAction || "",
      unclearCriteria: qualification.unclearCriteria,
      manualReviewRequired: qualification.manualReviewRequired,
      remappedFromNoBid: false,
      remappedFromWillBid: false,
      rawResult: qualification as unknown as Record<string, unknown>,
    };
  }

  const unclearFromFailures = qualification.failedCriteria
    .map((item) => String(item).trim())
    .filter(Boolean);
  const unclearCriteria =
    qualification.unclearCriteria.length > 0
      ? qualification.unclearCriteria
      : unclearFromFailures.length > 0
        ? unclearFromFailures
        : [
            "ChatGPT returned No Bid — confirm before closing as No Bid",
          ];

  const reasonPrefix =
    "ChatGPT returned No Bid; stored as VERIFY for manual review. ";
  const reason = qualification.reason.trim().startsWith(reasonPrefix.trim())
    ? qualification.reason
    : `${reasonPrefix}${qualification.reason}`.trim();

  return {
    status: "VERIFY",
    decisionLabel: TENDER_DECISION_LABELS.VERIFY,
    reason,
    requiredAction:
      qualification.requiredAction?.trim() ||
      TENDER_DECISION_REQUIRED_ACTIONS.VERIFY,
    unclearCriteria,
    manualReviewRequired: true,
    remappedFromNoBid: true,
    remappedFromWillBid: false,
    rawResult: {
      ...(qualification as unknown as Record<string, unknown>),
      status: "VERIFY",
      decisionLabel: TENDER_DECISION_LABELS.VERIFY,
      reason,
      requiredAction:
        qualification.requiredAction?.trim() ||
        TENDER_DECISION_REQUIRED_ACTIONS.VERIFY,
      unclearCriteria,
      manualReviewRequired: true,
      chatgptOriginalStatus: originalStatus,
      supabaseStatusRemap: "NO_GO_TO_VERIFY",
    },
  };
}

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

  const existingStatus = await readTenderQualificationStatus(
    sourcePortal,
    sourceTenderId,
  );
  if (existingStatus === "GO") {
    const msg = `PRESERVE_MANUAL_WILL_BID=true portal=${sourcePortal} tender=${sourceTenderId}`;
    console.log(msg);
    logger?.info?.(msg);
    await maybeEnrichTenderFinancialsFromQualification({
      sourcePortal,
      sourceTenderId,
      qualification: qualification as unknown as Record<string, unknown>,
      logger,
    });
    return { ok: true, error: null };
  }

  const forStore = qualificationStatusForSupabasePersist(qualification);
  if (forStore.remappedFromNoBid) {
    const msg = `CHATGPT_NO_BID_STORED_AS_VERIFY=true portal=${sourcePortal} tender=${sourceTenderId}`;
    console.log(msg);
    logger?.info?.(msg);
  }
  if (forStore.remappedFromWillBid) {
    const msg = `CHATGPT_WILL_BID_STORED_AS_MAY_BID=true portal=${sourcePortal} tender=${sourceTenderId}`;
    console.log(msg);
    logger?.info?.(msg);
  }

  const result = await upsertQualificationResult({
    sourcePortal,
    sourceTenderId,
    status: forStore.status,
    decisionLabel: forStore.decisionLabel,
    verdict: qualification.verdict,
    reason: forStore.reason,
    requiredAction: forStore.requiredAction || null,
    confidence: Number(qualification.confidence) || 0,
    matchedCriteria: qualification.matchedCriteria,
    failedCriteria: qualification.failedCriteria,
    unclearCriteria: forStore.unclearCriteria,
    missingDocuments: qualification.missingDocuments,
    conditions: qualification.conditions,
    partnershipRequiredFor: qualification.partnershipRequiredFor,
    partnershipModeAllowed: qualification.partnershipModeAllowed,
    manualReviewRequired: forStore.manualReviewRequired,
    requiresDetailedTenderReview: Boolean(
      qualification.requiresDetailedTenderReview,
    ),
    evidenceFiles: qualification.evidenceFiles || [],
    rawResponse,
    rawResult: forStore.rawResult,
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

async function readTenderQualificationStatus(
  sourcePortal: "TENDER247" | "BIDASSIST",
  sourceTenderId: string,
): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("agenttender_tenders")
      .select("qualification_status")
      .eq("source_portal", sourcePortal)
      .eq("source_tender_id", sourceTenderId)
      .maybeSingle();
    if (error || !data) return null;
    const status = data.qualification_status;
    return status == null ? null : String(status);
  } catch {
    return null;
  }
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
