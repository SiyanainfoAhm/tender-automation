import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import type { AiChunkDraft, AiSourceType } from "@/server/ai/rag/types";

/**
 * Replace active chunks for a source.
 *
 * Must deactivate first: partial unique index
 * `agenttender_ai_document_chunks_active_uidx` is on
 * (source_type, source_id, chunk_index) WHERE is_active.
 * Insert-before-deactivate fails when content_hash is unchanged (forced reindex).
 * Embeddings are computed before this call so the DB window stays short.
 */
export async function replaceActiveChunks(options: {
  sourceType: AiSourceType;
  sourceId: string;
  contentHash: string;
  chunks: AiChunkDraft[];
}): Promise<void> {
  const supabase = getServerSupabase();
  const now = new Date().toISOString();

  if (options.chunks.length === 0) {
    throw new Error("Cannot replace active chunks with an empty set.");
  }

  const { error: deactivateError } = await supabase
    .from("agenttender_ai_document_chunks")
    .update({ is_active: false, updated_at: now })
    .eq("source_type", options.sourceType)
    .eq("source_id", options.sourceId)
    .eq("is_active", true);
  if (deactivateError) throw new Error(deactivateError.message);

  const rows = options.chunks.map((chunk) => ({
    company_id: chunk.companyId,
    tender_id: chunk.tenderId,
    source_type: chunk.sourceType,
    source_id: chunk.sourceId,
    document_name: chunk.documentName,
    document_url: chunk.documentUrl,
    document_type: chunk.documentType,
    page_number: chunk.pageNumber,
    section: chunk.section,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    content_hash: chunk.contentHash,
    embedding: chunk.embedding,
    metadata: chunk.metadata,
    is_active: true,
    created_at: now,
    updated_at: now,
  }));

  const { error: insertError } = await supabase
    .from("agenttender_ai_document_chunks")
    .insert(rows);
  if (insertError) throw new Error(insertError.message);
}

export async function deactivateActiveChunks(options: {
  sourceType: AiSourceType;
  sourceId: string;
}): Promise<number> {
  const supabase = getServerSupabase();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("agenttender_ai_document_chunks")
    .update({ is_active: false, updated_at: now })
    .eq("source_type", options.sourceType)
    .eq("source_id", options.sourceId)
    .eq("is_active", true)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function countActiveChunks(options: {
  sourceType: AiSourceType;
  sourceId: string;
}): Promise<number> {
  const supabase = getServerSupabase();
  const { count, error } = await supabase
    .from("agenttender_ai_document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("source_type", options.sourceType)
    .eq("source_id", options.sourceId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
