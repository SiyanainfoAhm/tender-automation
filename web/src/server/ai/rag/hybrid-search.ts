import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import type { AiSourceType } from "@/server/ai/rag/types";
import {
  HYBRID_FTS_WEIGHT,
  HYBRID_VECTOR_WEIGHT,
  MAX_COMPANY_CHUNKS,
  MAX_TENDER_CHUNKS,
  MIN_COMBINED_SCORE,
  type RetrievedChunk,
} from "@/server/ai/rag/retrieval-types";

type RpcChunkRow = {
  id: string;
  company_id: string | null;
  tender_id: string | null;
  source_type: string;
  source_id: string;
  document_name: string | null;
  document_url: string | null;
  document_type: string | null;
  page_number: number | null;
  section: string | null;
  chunk_index: number;
  content: string;
  content_hash: string;
  metadata: Record<string, unknown> | null;
  similarity?: number | null;
  fts_rank?: number | null;
};

function mapRow(
  row: RpcChunkRow,
  scores: { vector: number | null; fts: number | null; combined: number },
): RetrievedChunk {
  return {
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : null,
    tenderId: row.tender_id ? String(row.tender_id) : null,
    sourceType: row.source_type as AiSourceType,
    sourceId: String(row.source_id),
    documentName: row.document_name,
    documentUrl: row.document_url,
    documentType: row.document_type,
    pageNumber: row.page_number == null ? null : Number(row.page_number),
    section: row.section,
    chunkIndex: Number(row.chunk_index),
    content: String(row.content || ""),
    contentHash: String(row.content_hash || ""),
    metadata:
      row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    score: scores.combined,
    vectorSimilarity: scores.vector,
    ftsRank: scores.fts,
  };
}

/**
 * Merge vector + FTS candidates.
 * Weighting: combined = 0.65 * vector_similarity + 0.35 * normalized_fts_rank
 * (FTS ranks are max-normalized within the candidate set).
 * Keyword-only FTS hits without vector still keep 0.35 * normalized FTS.
 */
export function mergeHybridCandidates(options: {
  vectorRows: RpcChunkRow[];
  ftsRows: RpcChunkRow[];
  maxResults: number;
  minScore?: number;
}): RetrievedChunk[] {
  const byId = new Map<
    string,
    {
      row: RpcChunkRow;
      vector: number | null;
      fts: number | null;
    }
  >();

  for (const row of options.vectorRows) {
    const id = String(row.id);
    const existing = byId.get(id);
    const sim = Number(row.similarity ?? 0);
    if (existing) {
      existing.vector = Math.max(existing.vector ?? 0, sim);
    } else {
      byId.set(id, { row, vector: sim, fts: null });
    }
  }

  for (const row of options.ftsRows) {
    const id = String(row.id);
    const existing = byId.get(id);
    const rank = Number(row.fts_rank ?? 0);
    if (existing) {
      existing.fts = Math.max(existing.fts ?? 0, rank);
      // Prefer richer row content if needed
      existing.row = existing.row.content ? existing.row : row;
    } else {
      byId.set(id, { row, vector: null, fts: rank });
    }
  }

  const maxFts = Math.max(
    0.0001,
    ...Array.from(byId.values()).map((item) => item.fts ?? 0),
  );

  const merged = Array.from(byId.values()).map((item) => {
    const vector = item.vector;
    const ftsNorm = item.fts == null ? 0 : item.fts / maxFts;
    const combined =
      HYBRID_VECTOR_WEIGHT * (vector ?? 0) + HYBRID_FTS_WEIGHT * ftsNorm;
    return mapRow(item.row, {
      vector,
      fts: item.fts,
      combined,
    });
  });

  const minScore = options.minScore ?? MIN_COMBINED_SCORE;
  const filtered = merged
    .filter((chunk) => chunk.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return diversifyChunks(filtered, options.maxResults);
}

/**
 * Prefer diverse sources/sections; avoid near-duplicate adjacent chunk indexes
 * from the same source unless they score much higher.
 */
export function diversifyChunks(
  chunks: RetrievedChunk[],
  maxResults: number,
): RetrievedChunk[] {
  const selected: RetrievedChunk[] = [];
  const seenContentPrefix = new Set<string>();

  for (const chunk of chunks) {
    if (selected.length >= maxResults) break;

    const prefix = chunk.content.slice(0, 160).toLowerCase().replace(/\s+/g, " ");
    if (seenContentPrefix.has(prefix)) continue;

    const adjacentDup = selected.some(
      (prev) =>
        prev.sourceId === chunk.sourceId &&
        Math.abs(prev.chunkIndex - chunk.chunkIndex) <= 1 &&
        chunk.score < prev.score * 0.92,
    );
    if (adjacentDup) continue;

    selected.push(chunk);
    seenContentPrefix.add(prefix);
  }

  return selected;
}

export async function searchTenderChunksHybrid(options: {
  tenderId: string;
  queryEmbedding: number[];
  ftsQuery: string;
  matchCount?: number;
  minSimilarity?: number;
}): Promise<{
  chunks: RetrievedChunk[];
  vectorMs: number;
  ftsMs: number;
}> {
  const supabase = getServerSupabase();
  const limit = Math.max(options.matchCount ?? MAX_TENDER_CHUNKS * 2, 8);

  const vectorStarted = Date.now();
  const { data: vectorData, error: vectorError } = await supabase.rpc(
    "agenttender_match_tender_chunks",
    {
      p_tender_id: options.tenderId,
      p_query_embedding: options.queryEmbedding,
      p_match_count: limit,
      p_min_similarity: options.minSimilarity ?? 0.22,
    },
  );
  const vectorMs = Date.now() - vectorStarted;
  if (vectorError) throw new Error(vectorError.message);

  const ftsStarted = Date.now();
  const { data: ftsData, error: ftsError } = await supabase.rpc(
    "agenttender_match_tender_chunks_fts",
    {
      p_tender_id: options.tenderId,
      p_query: options.ftsQuery,
      p_match_count: limit,
    },
  );
  const ftsMs = Date.now() - ftsStarted;
  if (ftsError) throw new Error(ftsError.message);

  const chunks = mergeHybridCandidates({
    vectorRows: (vectorData || []) as RpcChunkRow[],
    ftsRows: (ftsData || []) as RpcChunkRow[],
    maxResults: MAX_TENDER_CHUNKS,
  }).filter(
    (chunk) =>
      chunk.sourceType === "TENDER_DOCUMENT" &&
      chunk.tenderId === options.tenderId,
  );

  return { chunks, vectorMs, ftsMs };
}

export async function searchCompanyChunksHybrid(options: {
  companyId: string;
  queryEmbedding: number[];
  ftsQuery: string;
  matchCount?: number;
  minSimilarity?: number;
}): Promise<{
  chunks: RetrievedChunk[];
  vectorMs: number;
  ftsMs: number;
}> {
  const supabase = getServerSupabase();
  const limit = Math.max(options.matchCount ?? MAX_COMPANY_CHUNKS * 2, 6);

  const vectorStarted = Date.now();
  const { data: vectorData, error: vectorError } = await supabase.rpc(
    "agenttender_match_company_chunks",
    {
      p_company_id: options.companyId,
      p_query_embedding: options.queryEmbedding,
      p_match_count: limit,
      p_min_similarity: options.minSimilarity ?? 0.22,
    },
  );
  const vectorMs = Date.now() - vectorStarted;
  if (vectorError) throw new Error(vectorError.message);

  const ftsStarted = Date.now();
  const { data: ftsData, error: ftsError } = await supabase.rpc(
    "agenttender_match_company_chunks_fts",
    {
      p_company_id: options.companyId,
      p_query: options.ftsQuery,
      p_match_count: limit,
    },
  );
  const ftsMs = Date.now() - ftsStarted;
  if (ftsError) throw new Error(ftsError.message);

  const chunks = mergeHybridCandidates({
    vectorRows: (vectorData || []) as RpcChunkRow[],
    ftsRows: (ftsData || []) as RpcChunkRow[],
    maxResults: MAX_COMPANY_CHUNKS,
  }).filter(
    (chunk) =>
      chunk.companyId === options.companyId &&
      chunk.tenderId == null &&
      (chunk.sourceType === "COMPANY_DOCUMENT" ||
        chunk.sourceType === "COMPANY_PROFILE"),
  );

  return { chunks, vectorMs, ftsMs };
}

/** Merge chunk lists by id, keeping the highest combined score, then diversify. */
export function mergeRetrievedChunkLists(
  lists: RetrievedChunk[][],
  maxResults: number,
): RetrievedChunk[] {
  const byId = new Map<string, RetrievedChunk>();
  for (const list of lists) {
    for (const chunk of list) {
      const existing = byId.get(chunk.id);
      if (!existing || chunk.score > existing.score) {
        byId.set(chunk.id, chunk);
      }
    }
  }
  return diversifyChunks(
    Array.from(byId.values()).sort((a, b) => b.score - a.score),
    maxResults,
  );
}
