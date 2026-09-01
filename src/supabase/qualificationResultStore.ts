import { getSupabaseAdminClient, isSupabaseConfigured } from "./client.js";

export type QualificationStatus =
  | "GO"
  | "CONDITIONAL_GO"
  | "PARTNER_BID"
  | "VERIFY"
  | "NO_GO"
  | "DUPLICATE";

export type QualificationResultInput = {
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;

  status: QualificationStatus;
  decisionLabel: string;
  verdict: string;
  reason: string;
  requiredAction: string | null;
  confidence: number;

  matchedCriteria: unknown[];
  failedCriteria: unknown[];
  unclearCriteria: unknown[];
  missingDocuments: unknown[];
  conditions: unknown[];

  partnershipRequiredFor: unknown[];
  partnershipModeAllowed: unknown[];

  manualReviewRequired: boolean;
  requiresDetailedTenderReview: boolean;
  evidenceFiles: unknown[];

  rawResponse: string;
  rawResult: Record<string, unknown>;

  chatUrl: string | null;
  promptVersion: string | null;
  modelName: string | null;
};

export type UpsertQualificationResult = {
  ok: boolean;
  id: string | null;
  tender_id: string | null;
  status: QualificationStatus | null;
  updated_at: string | null;
  error: string | null;
};

const TENDERS = "agenttender_tenders";
const QUALIFICATIONS = "agenttender_qualification_results";

function logLabel(portal: string, id: string): string {
  if (portal === "TENDER247") {
    return `T247-${id}`;
  }
  if (portal === "BIDASSIST") {
    return id.toUpperCase().startsWith("BA-") ? id : `BA-${id}`;
  }
  return `${portal}-${id}`;
}

export async function upsertQualificationResult(
  input: QualificationResultInput,
): Promise<UpsertQualificationResult> {
  const label = logLabel(input.sourcePortal, input.sourceTenderId);
  console.log(`SUPABASE_QUALIFICATION_UPSERT_START=${label}`);

  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      id: null,
      tender_id: null,
      status: null,
      updated_at: null,
      error: "Supabase is not configured",
    };
  }

  const client = getSupabaseAdminClient();

  const { data: tender, error: tenderError } = await client
    .from(TENDERS)
    .select("id")
    .eq("source_portal", input.sourcePortal)
    .eq("source_tender_id", String(input.sourceTenderId))
    .maybeSingle();

  if (tenderError) {
    return {
      ok: false,
      id: null,
      tender_id: null,
      status: null,
      updated_at: null,
      error: tenderError.message,
    };
  }
  if (!tender?.id) {
    return {
      ok: false,
      id: null,
      tender_id: null,
      status: null,
      updated_at: null,
      error: `Parent tender row missing for ${input.sourcePortal}/${input.sourceTenderId}`,
    };
  }

  const row = {
    tender_id: String(tender.id),
    source_portal: input.sourcePortal,
    source_tender_id: String(input.sourceTenderId),
    status: input.status,
    decision_label: input.decisionLabel,
    verdict: input.verdict,
    reason: input.reason,
    required_action: input.requiredAction,
    confidence: input.confidence,
    matched_criteria: input.matchedCriteria,
    failed_criteria: input.failedCriteria,
    unclear_criteria: input.unclearCriteria,
    missing_documents: input.missingDocuments,
    conditions: input.conditions,
    partnership_required_for: input.partnershipRequiredFor,
    partnership_mode_allowed: input.partnershipModeAllowed,
    manual_review_required: input.manualReviewRequired,
    requires_detailed_tender_review: input.requiresDetailedTenderReview,
    evidence_files: input.evidenceFiles,
    raw_response: input.rawResponse,
    raw_result: input.rawResult,
    chat_url: input.chatUrl,
    prompt_version: input.promptVersion,
    model_name: input.modelName,
    qualified_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from(QUALIFICATIONS)
    .upsert(row, {
      onConflict: "source_portal,source_tender_id",
      ignoreDuplicates: false,
    })
    .select("id, tender_id, status, updated_at")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      id: null,
      tender_id: String(tender.id),
      status: null,
      updated_at: null,
      error: error?.message || "Qualification upsert returned no row",
    };
  }

  console.log(`SUPABASE_QUALIFICATION_UPSERTED=${label}`);

  const verified = await verifyQualificationResultRow(
    input.sourcePortal,
    input.sourceTenderId,
    input.status,
  );
  if (!verified.ok) {
    return {
      ok: false,
      id: String(data.id),
      tender_id: String(data.tender_id),
      status: data.status as QualificationStatus,
      updated_at: data.updated_at ? String(data.updated_at) : null,
      error: verified.error,
    };
  }

  console.log(`SUPABASE_QUALIFICATION_VERIFIED=${label}`);

  return {
    ok: true,
    id: String(data.id),
    tender_id: String(data.tender_id),
    status: data.status as QualificationStatus,
    updated_at: data.updated_at ? String(data.updated_at) : null,
    error: null,
  };
}

export async function verifyQualificationResultRow(
  sourcePortal: "TENDER247" | "BIDASSIST",
  sourceTenderId: string,
  expectedStatus?: QualificationStatus,
): Promise<{ ok: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured" };
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from(QUALIFICATIONS)
    .select(
      "id, source_portal, source_tender_id, status, raw_response, raw_result",
    )
    .eq("source_portal", sourcePortal)
    .eq("source_tender_id", String(sourceTenderId))
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: "No qualification row returned" };
  }
  if (data.source_portal !== sourcePortal) {
    return { ok: false, error: "source_portal mismatch" };
  }
  if (String(data.source_tender_id) !== String(sourceTenderId)) {
    return { ok: false, error: "source_tender_id mismatch" };
  }
  if (expectedStatus && data.status !== expectedStatus) {
    return { ok: false, error: "status mismatch" };
  }
  if (
    typeof data.raw_response !== "string" ||
    data.raw_response.trim().length === 0
  ) {
    return { ok: false, error: "raw_response is empty" };
  }
  if (
    data.raw_result === null ||
    typeof data.raw_result !== "object" ||
    Array.isArray(data.raw_result)
  ) {
    return { ok: false, error: "raw_result is not populated" };
  }

  return { ok: true, error: null };
}
