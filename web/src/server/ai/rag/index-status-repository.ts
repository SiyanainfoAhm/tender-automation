import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import type {
  AiIndexStatusValue,
  AiSourceType,
} from "@/server/ai/rag/types";

export type AiIndexStatusRow = {
  id: string;
  companyId: string | null;
  tenderId: string | null;
  sourceType: AiSourceType;
  sourceId: string;
  documentName: string | null;
  documentUrl: string | null;
  contentHash: string | null;
  status: AiIndexStatusValue;
  chunkCount: number;
  lastIndexedAt: string | null;
  lastAttemptedAt: string | null;
  errorMessage: string | null;
};

function mapStatus(row: Record<string, unknown>): AiIndexStatusRow {
  return {
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : null,
    tenderId: row.tender_id ? String(row.tender_id) : null,
    sourceType: row.source_type as AiSourceType,
    sourceId: String(row.source_id),
    documentName: row.document_name ? String(row.document_name) : null,
    documentUrl: row.document_url ? String(row.document_url) : null,
    contentHash: row.content_hash ? String(row.content_hash) : null,
    status: row.status as AiIndexStatusValue,
    chunkCount: Number(row.chunk_count || 0),
    lastIndexedAt: row.last_indexed_at ? String(row.last_indexed_at) : null,
    lastAttemptedAt: row.last_attempted_at
      ? String(row.last_attempted_at)
      : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
  };
}

export async function getIndexStatus(options: {
  sourceType: AiSourceType;
  sourceId: string;
}): Promise<AiIndexStatusRow | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_ai_document_index_status")
    .select("*")
    .eq("source_type", options.sourceType)
    .eq("source_id", options.sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapStatus(data as Record<string, unknown>) : null;
}

export async function upsertIndexStatus(options: {
  companyId: string | null;
  tenderId: string | null;
  sourceType: AiSourceType;
  sourceId: string;
  documentName?: string | null;
  documentUrl?: string | null;
  contentHash?: string | null;
  status: AiIndexStatusValue;
  chunkCount?: number;
  errorMessage?: string | null;
  markIndexed?: boolean;
}): Promise<void> {
  const supabase = getServerSupabase();
  const now = new Date().toISOString();
  const existing = await getIndexStatus({
    sourceType: options.sourceType,
    sourceId: options.sourceId,
  });

  const payload: Record<string, unknown> = {
    company_id: options.companyId,
    tender_id: options.tenderId,
    source_type: options.sourceType,
    source_id: options.sourceId,
    document_name: options.documentName ?? existing?.documentName ?? null,
    document_url: options.documentUrl ?? existing?.documentUrl ?? null,
    content_hash:
      options.contentHash === undefined
        ? existing?.contentHash ?? null
        : options.contentHash,
    status: options.status,
    chunk_count:
      options.chunkCount === undefined
        ? existing?.chunkCount ?? 0
        : options.chunkCount,
    last_attempted_at: now,
    error_message:
      options.errorMessage === undefined
        ? existing?.errorMessage ?? null
        : options.errorMessage,
    updated_at: now,
  };

  if (options.markIndexed) {
    payload.last_indexed_at = now;
    payload.error_message = null;
  }

  if (existing) {
    const { error } = await supabase
      .from("agenttender_ai_document_index_status")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("agenttender_ai_document_index_status")
    .insert({ ...payload, created_at: now });
  if (error) throw new Error(error.message);
}
