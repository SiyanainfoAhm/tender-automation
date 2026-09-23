import "server-only";

import { getServerSupabase } from "@/lib/db/server";

export type TenderIndexReadiness = {
  status: "ready" | "partial" | "none";
  indexedSources: number;
  failedSources: number;
  pendingSources: number;
  activeChunkCount: number;
  warnings: string[];
};

export async function getTenderIndexReadiness(
  tenderId: string,
): Promise<TenderIndexReadiness> {
  const supabase = getServerSupabase();

  const [{ data: statuses, error: statusError }, { count, error: countError }] =
    await Promise.all([
      supabase
        .from("agenttender_ai_document_index_status")
        .select("status, source_id")
        .eq("tender_id", tenderId)
        .eq("source_type", "TENDER_DOCUMENT"),
      supabase
        .from("agenttender_ai_document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("tender_id", tenderId)
        .eq("source_type", "TENDER_DOCUMENT")
        .eq("is_active", true),
    ]);

  if (statusError) throw new Error(statusError.message);
  if (countError) throw new Error(countError.message);

  const rows = statuses || [];
  const indexedSources = rows.filter((row) => row.status === "INDEXED").length;
  const failedSources = rows.filter(
    (row) => row.status === "INDEX_FAILED",
  ).length;
  const pendingSources = rows.filter((row) =>
    ["NOT_INDEXED", "INDEXING", "NEEDS_REINDEX"].includes(String(row.status)),
  ).length;
  const activeChunkCount = count ?? 0;

  const warnings: string[] = [];
  let status: TenderIndexReadiness["status"] = "none";

  if (activeChunkCount === 0 && indexedSources === 0) {
    status = "none";
    warnings.push(
      "AI knowledge for this tender has not been indexed yet.",
    );
  } else if (failedSources > 0 || pendingSources > 0) {
    status = "partial";
    warnings.push(
      "Some tender documents are not fully indexed; analysis may be incomplete.",
    );
  } else {
    status = "ready";
  }

  return {
    status,
    indexedSources,
    failedSources,
    pendingSources,
    activeChunkCount,
    warnings,
  };
}
