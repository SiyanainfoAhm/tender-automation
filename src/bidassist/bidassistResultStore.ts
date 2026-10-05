import { getSupabaseAdminClient, isSupabaseConfigured } from "../supabase/client.js";
import { normalizeBidderName, type ParsedAmount } from "./bidassistResultParser.js";
import { preserveBidassistResultMetadata } from "./bidassistResultMetadata.js";
export type ResultState = "FOUND" | "NOT_FOUND" | "AMBIGUOUS" | "NO_AOC_YET" | "SCRAPED" | "PARTIAL" | "BLOCKED" | "ERROR";
export interface ResultBidder { name: string; address?: string | null; bid?: ParsedAmount; award?: ParsedAmount; rank?: string | null; status?: string | null; awarded: boolean; raw?: Record<string, unknown> }
export interface ResultDocument { name: string; fileName?: string | null; description?: string | null; type?: string | null; mimeType?: string | null; sourceUrl?: string | null; storageUrl?: string | null; downloadStatus?: "DOWNLOADED" | "METADATA_ONLY" | "SOURCE_RESTRICTED" | "DOWNLOAD_FAILED"; raw?: Record<string, unknown> }
export async function persistBidassistResult(input: { tenderId: string; state: ResultState; reason?: string; sourceUrl?: string; stage?: string; contractDate?: string | null; contract?: ParsedAmount; numberOfBids?: number | null; bidders?: ResultBidder[]; documents?: ResultDocument[]; raw?: Record<string, unknown> }): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error("Supabase is not configured");
  const db = getSupabaseAdminClient(); const now = new Date().toISOString();
  const { data: existing, error: existingError } = await db.from("agenttender_tender_results").select("source_url,result_stage,contract_date,contract_amount,contract_amount_display,currency,number_of_bids,awarded_bidder_name,raw_data").eq("tender_id", input.tenderId).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const metadata = preserveBidassistResultMetadata(
    { stage: existing?.result_stage ?? null, contractDate: existing?.contract_date ?? null },
    { stage: input.stage?.trim() || null, contractDate: input.contractDate?.trim() || null },
  );
  const awardedBidder = input.bidders?.find((bidder) => bidder.awarded)?.name;
  const { error } = await db.from("agenttender_tender_results").upsert({ tender_id: input.tenderId, source: "BIDASSIST", source_url: input.sourceUrl ?? existing?.source_url ?? null, result_stage: metadata.stage, contract_date: metadata.contractDate, contract_amount: input.contract?.normalized ?? existing?.contract_amount ?? null, contract_amount_display: input.contract?.display ?? existing?.contract_amount_display ?? null, currency: input.contract?.currency ?? existing?.currency ?? null, number_of_bids: input.numberOfBids ?? existing?.number_of_bids ?? null, awarded_bidder_name: awardedBidder ?? existing?.awarded_bidder_name ?? null, scrape_status: input.state, scrape_reason: input.reason ?? null, result_checked_at: now, result_last_updated_at: now, raw_data: { ...(existing?.raw_data && typeof existing.raw_data === "object" ? existing.raw_data : {}), ...(input.raw ?? {}) } }, { onConflict: "tender_id" });
  if (error) throw new Error(error.message);
  for (const bidder of input.bidders ?? []) { const name = normalizeBidderName(bidder.name); if (!name) continue; const r = await db.from("agenttender_tender_bidders").upsert({ tender_id: input.tenderId, normalized_bidder_name: name, bidder_name: bidder.name, bidder_address: bidder.address ?? null, bid_value: bidder.bid?.normalized ?? null, bid_value_display: bidder.bid?.display ?? null, award_amount: bidder.award?.normalized ?? null, award_amount_display: bidder.award?.display ?? null, currency: bidder.award?.currency ?? bidder.bid?.currency ?? null, rank: bidder.rank ?? null, status: bidder.status ?? null, is_awarded: bidder.awarded, source: "BIDASSIST", source_url: input.sourceUrl ?? null, raw_data: bidder.raw ?? {}, last_seen_at: now }, { onConflict: "tender_id,normalized_bidder_name" }); if (r.error) throw new Error(r.error.message); }
  if (!input.documents) return;
  // AOC records reflect the current successful download, not an accumulating history.
  const { error: deleteDocumentsError } = await db.from("agenttender_tender_aoc_documents").delete().eq("tender_id", input.tenderId);
  if (deleteDocumentsError) throw new Error(deleteDocumentsError.message);
  for (const doc of input.documents ?? []) { const key = (doc.sourceUrl || `${doc.name}|${doc.fileName || ""}`).trim(); const r = await db.from("agenttender_tender_aoc_documents").upsert({ tender_id: input.tenderId, external_document_key: key, document_name: doc.name, file_name: doc.fileName ?? null, description: doc.description ?? null, document_type: doc.type ?? null, mime_type: doc.mimeType ?? null, source_url: doc.sourceUrl ?? null, storage_url: doc.storageUrl ?? null, download_status: doc.downloadStatus ?? "METADATA_ONLY", raw_data: doc.raw ?? {}, last_seen_at: now }, { onConflict: "tender_id,external_document_key" }); if (r.error) throw new Error(r.error.message); }
}
