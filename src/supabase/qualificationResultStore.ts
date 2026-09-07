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
  /** Daily snapshot date — required once tenders are unique per scraped_date. */
  scrapedDate?: string | null;
  /** Prefer resolving by UUID when the parent row was just inserted/updated. */
  tenderId?: string | null;

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

  let tender: { id: string } | null = null;
  let tenderError: { message: string } | null = null;

  if (input.tenderId) {
    const byUuid = await client
      .from(TENDERS)
      .select("id")
      .eq("id", String(input.tenderId))
      .maybeSingle();
    tender = byUuid.data ? { id: String(byUuid.data.id) } : null;
    tenderError = byUuid.error;
  }

  if (!tender && input.scrapedDate) {
    const byDay = await client
      .from(TENDERS)
      .select("id")
      .eq("source_portal", input.sourcePortal)
      .eq("source_tender_id", String(input.sourceTenderId))
      .eq("scraped_date", String(input.scrapedDate).slice(0, 10))
      .maybeSingle();
    tender = byDay.data ? { id: String(byDay.data.id) } : null;
    tenderError = byDay.error;
  }

  if (!tender) {
    // Ambiguous after daily-snapshot uniqueness — prefer most recent scraped_date.
    const fallback = await client
      .from(TENDERS)
      .select("id")
      .eq("source_portal", input.sourcePortal)
      .eq("source_tender_id", String(input.sourceTenderId))
      .order("scraped_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    tender = fallback.data ? { id: String(fallback.data.id) } : null;
    tenderError = fallback.error;
  }

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
      onConflict: "tender_id",
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
    { tenderId: String(tender.id) },
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
  options?: { tenderId?: string | null },
): Promise<{ ok: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured" };
  }

  const client = getSupabaseAdminClient();
  // Prefer tender_id: same source_tender_id can have one qual row per scraped_date.
  let query = client
    .from(QUALIFICATIONS)
    .select(
      "id, tender_id, source_portal, source_tender_id, status, raw_response, raw_result",
    )
    .eq("source_portal", sourcePortal)
    .eq("source_tender_id", String(sourceTenderId));

  if (options?.tenderId) {
    query = query.eq("tender_id", String(options.tenderId));
  } else {
    // Legacy callers without tender UUID — take the newest row only.
    query = query.order("qualified_at", { ascending: false }).limit(1);
  }

  const { data, error } = await query.maybeSingle();

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
  if (
    options?.tenderId &&
    String(data.tender_id) !== String(options.tenderId)
  ) {
    return { ok: false, error: "tender_id mismatch" };
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
