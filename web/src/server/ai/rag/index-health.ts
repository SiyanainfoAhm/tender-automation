/**
 * Index health helpers for Ask AI warnings (Phase 8).
 */
import "server-only";

import { getServerSupabase } from "@/lib/db/server";

export type TenderIndexHealth = {
  indexedDocuments: number;
  failedSources: number;
  needsReindexSources: number;
  indexingSources: number;
  companyIndexedSources: number;
};

export async function getTenderIndexHealth(options: {
  tenderId: string;
  companyId: string;
}): Promise<TenderIndexHealth> {
  const supabase = getServerSupabase();

  const [tenderStatus, companyStatus] = await Promise.all([
    supabase
      .from("agenttender_ai_document_index_status")
      .select("status, source_id")
      .eq("tender_id", options.tenderId)
      .eq("source_type", "TENDER_DOCUMENT"),
    supabase
      .from("agenttender_ai_document_index_status")
      .select("status, source_id")
      .eq("company_id", options.companyId)
      .is("tender_id", null)
      .in("source_type", ["COMPANY_DOCUMENT", "COMPANY_PROFILE"]),
  ]);

  const tenderRows = tenderStatus.data || [];
  const companyRows = companyStatus.data || [];

  return {
    indexedDocuments: tenderRows.filter((r) => r.status === "INDEXED").length,
    failedSources: tenderRows.filter((r) => r.status === "INDEX_FAILED").length,
    needsReindexSources: tenderRows.filter((r) => r.status === "NEEDS_REINDEX")
      .length,
    indexingSources: tenderRows.filter((r) => r.status === "INDEXING").length,
    companyIndexedSources: companyRows.filter((r) => r.status === "INDEXED")
      .length,
  };
}
