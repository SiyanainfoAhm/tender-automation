import { getSupabaseAdminClient, isSupabaseConfigured } from "../supabase/client.js";
import type {
  DecisionSource,
  PersistPrescreenOptions,
  PrescreenDecision,
  PrescreenSourcePortal,
  PrescreenStatus,
} from "./prescreenTypes.js";

export type TenderPrescreenGateRow = {
  id: string;
  source_portal: PrescreenSourcePortal;
  source_tender_id: string;
  prescreen_status: string | null;
  chatgpt_eligible: boolean | null;
  prescreen_reason_code: string | null;
  qualification_status: string | null;
  decision_source: string | null;
};

export async function persistPrescreenResult(
  options: PersistPrescreenOptions,
): Promise<{ ok: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured" };
  }

  const client = getSupabaseAdminClient();
  const { tenderId, decision, sourcePortal, sourceTenderId, metadataHash } =
    options;
  const evaluatedAt = new Date().toISOString();

  const resultRow = {
    tender_id: tenderId,
    source_portal: sourcePortal,
    source_tender_id: sourceTenderId,
    status: decision.status as PrescreenStatus,
    effective_status: decision.effectiveStatus,
    chatgpt_eligible: decision.chatgptEligible,
    reason_code: decision.reasonCode,
    reason: decision.reason,
    facts: decision.facts,
    rules_version: decision.rulesVersion,
    metadata_hash: metadataHash ?? null,
    evaluated_at: evaluatedAt,
  };

  const { error: upsertError } = await client
    .from("agenttender_prescreen_results")
    .upsert(resultRow, { onConflict: "tender_id" });

  if (upsertError) {
    return { ok: false, error: upsertError.message };
  }

  const tenderPatch: Record<string, unknown> = {
    prescreen_status: decision.status,
    prescreen_reason_code: decision.reasonCode,
    prescreen_reason: decision.reason,
    chatgpt_eligible: decision.chatgptEligible,
    prescreened_at: evaluatedAt,
    prescreen_rules_version: decision.rulesVersion,
  };

  if (decision.status === "REJECTED") {
    tenderPatch.qualification_status = "NO_GO";
    tenderPatch.decision_source = "PRESCREEN" satisfies DecisionSource;
  } else if (decision.status === "MANUAL_REVIEW" || decision.status === "ERROR") {
    tenderPatch.qualification_status = "VERIFY";
    tenderPatch.decision_source = "PRESCREEN" satisfies DecisionSource;
  } else if (decision.status === "PASSED") {
    // Do not manufacture a qualification status for PASSED
    tenderPatch.decision_source = null;
  }

  const { error: tenderError } = await client
    .from("agenttender_tenders")
    .update(tenderPatch)
    .eq("id", tenderId);

  if (tenderError) {
    return { ok: false, error: tenderError.message };
  }

  return { ok: true, error: null };
}

export async function getTenderPrescreenGate(options: {
  sourcePortal: PrescreenSourcePortal;
  sourceTenderId: string;
}): Promise<{
  ok: boolean;
  row: TenderPrescreenGateRow | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured()) {
    return { ok: false, row: null, error: "Supabase is not configured" };
  }
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("agenttender_tenders")
    .select(
      "id, source_portal, source_tender_id, prescreen_status, chatgpt_eligible, prescreen_reason_code, qualification_status, decision_source",
    )
    .eq("source_portal", options.sourcePortal)
    .eq("source_tender_id", options.sourceTenderId)
    .maybeSingle();

  if (error) {
    return { ok: false, row: null, error: error.message };
  }
  return {
    ok: true,
    row: (data as TenderPrescreenGateRow | null) ?? null,
    error: null,
  };
}

import { asiaKolkataDayBounds } from "./prescreenDayBounds.js";

export type PrescreenBackfillListRow = {
  id: string;
  source_portal: PrescreenSourcePortal;
  source_tender_id: string;
  title: string;
  category: string | null;
  description: string | null;
  closing_date: string | null;
  tender_value: number | null;
  tender_value_text: string | null;
  emd_amount: number | null;
  emd_text: string | null;
  document_archive_available: boolean;
  content_hash: string | null;
};

type RawBackfillRow = PrescreenBackfillListRow & {
  crawled_at?: string | null;
  first_seen_at?: string | null;
  created_at?: string | null;
};

export async function listTendersForPrescreenBackfill(options: {
  dateIso: string;
  sourcePortal?: PrescreenSourcePortal | null;
  sourceTenderId?: string | null;
}): Promise<{
  ok: boolean;
  rows: PrescreenBackfillListRow[];
  error: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      rows: [],
      error: "Supabase is not configured",
      code: "SUPABASE_NOT_CONFIGURED",
      details: null,
      hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    };
  }
  const client = getSupabaseAdminClient();
  const { startUtc, endUtcExclusive } = asiaKolkataDayBounds(options.dateIso);

  const selectCols =
    "id, source_portal, source_tender_id, title, category, description, closing_date, tender_value, tender_value_text, emd_amount, emd_text, document_archive_available, content_hash, crawled_at, first_seen_at, created_at";

  const queryColumn = async (
    column: "crawled_at" | "first_seen_at" | "created_at",
  ): Promise<{
    ok: boolean;
    rows: RawBackfillRow[];
    error: string | null;
    code?: string | null;
    details?: string | null;
    hint?: string | null;
  }> => {
    let query = client
      .from("agenttender_tenders")
      .select(selectCols)
      .gte(column, startUtc)
      .lt(column, endUtcExclusive);

    if (options.sourcePortal) {
      query = query.eq("source_portal", options.sourcePortal);
    }
    if (options.sourceTenderId) {
      query = query.eq("source_tender_id", options.sourceTenderId);
    }

    const { data, error } = await query;
    if (error) {
      return {
        ok: false,
        rows: [],
        error: error.message,
        code: error.code ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
      };
    }
    return {
      ok: true,
      rows: (data || []) as RawBackfillRow[],
      error: null,
    };
  };

  // Prefer crawled_at, then first_seen_at, then created_at (query all, coalesce filter below).
  const crawled = await queryColumn("crawled_at");
  if (!crawled.ok) {
    return {
      ok: false,
      rows: [],
      error: crawled.error,
      code: crawled.code,
      details: crawled.details,
      hint: crawled.hint,
    };
  }
  const firstSeen = await queryColumn("first_seen_at");
  if (!firstSeen.ok) {
    return {
      ok: false,
      rows: [],
      error: firstSeen.error,
      code: firstSeen.code,
      details: firstSeen.details,
      hint: firstSeen.hint,
    };
  }
  const created = await queryColumn("created_at");
  if (!created.ok) {
    return {
      ok: false,
      rows: [],
      error: created.error,
      code: created.code,
      details: created.details,
      hint: created.hint,
    };
  }

  const startMs = new Date(startUtc).getTime();
  const endMs = new Date(endUtcExclusive).getTime();
  const byId = new Map<string, PrescreenBackfillListRow>();

  for (const row of [...crawled.rows, ...firstSeen.rows, ...created.rows]) {
    const stamp = row.crawled_at || row.first_seen_at || row.created_at || null;
    if (!stamp) continue;
    const t = new Date(stamp).getTime();
    if (t < startMs || t >= endMs) continue;
    if (byId.has(row.id)) continue;
    byId.set(row.id, {
      id: row.id,
      source_portal: row.source_portal,
      source_tender_id: row.source_tender_id,
      title: row.title,
      category: row.category,
      description: row.description,
      closing_date: row.closing_date,
      tender_value: row.tender_value,
      tender_value_text: row.tender_value_text,
      emd_amount: row.emd_amount,
      emd_text: row.emd_text,
      document_archive_available: row.document_archive_available,
      content_hash: row.content_hash,
    });
  }

  return {
    ok: true,
    rows: [...byId.values()],
    error: null,
  };
}

export function logPrescreenDecision(
  logger: { info: (msg: string) => void },
  sourcePortal: PrescreenSourcePortal,
  sourceTenderId: string,
  decision: PrescreenDecision,
): void {
  const label =
    sourcePortal === "TENDER247"
      ? `T247-${sourceTenderId}`
      : sourceTenderId.toUpperCase().startsWith("BA-")
        ? sourceTenderId
        : `BA-${sourceTenderId}`;

  logger.info(`PRESCREEN_SOURCE=${sourcePortal}`);
  logger.info(`PRESCREEN_TENDER=${label}`);
  logger.info(`PRESCREEN_STATUS=${decision.status}`);
  logger.info(`PRESCREEN_REASON_CODE=${decision.reasonCode}`);
  logger.info(`PRESCREEN_CHATGPT_ELIGIBLE=${decision.chatgptEligible}`);
  logger.info(`PRESCREEN_RULES_VERSION=${decision.rulesVersion}`);

  if (sourcePortal === "TENDER247") {
    logger.info("PRESCREEN_EMD_RULE_APPLIED=true");
    logger.info(
      `PRESCREEN_IT_RELEVANCE_RULE_APPLIED=${decision.facts.itRelevanceRuleApplied}`,
    );
  } else {
    logger.info("PRESCREEN_EMD_RULE_APPLIED=false");
    logger.info("PRESCREEN_IT_RELEVANCE_RULE_APPLIED=false");
    logger.info(
      "BIDASSIST_CATEGORY_FILTER_ASSUMED=Software and IT Solutions",
    );
    if (decision.facts.tenderValueUnavailable && decision.chatgptEligible) {
      logger.info("BIDASSIST_TENDER_VALUE_UNAVAILABLE_CONTINUE_TO_CHATGPT");
    }
  }
}
