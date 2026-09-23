/**
 * Phase 8 quick-action answer cache.
 */
import "server-only";

import { createHash } from "node:crypto";
import { getServerSupabase } from "@/lib/db/server";
import type { AskAiAction, AskAiSource } from "@/lib/ai/ask-ai-stream";
import {
  getAskAiCacheTtlSeconds,
  TENDER_RAG_PROMPT_VERSION,
  TENDER_RAG_RETRIEVAL_VERSION,
} from "@/server/ai/rag/config";
import { hashEvidenceVersions } from "@/server/ai/rag/usage-log";
import { getAskAiChatModel } from "@/server/ai/rag/prompts";
import { isAskAiAction } from "@/lib/ai/ask-ai-actions";

const CACHEABLE_ACTIONS = new Set<AskAiAction>([
  "ASSESS_TENDER",
  "CHECK_ELIGIBILITY",
  "CHECK_SIMILAR_EXPERIENCE",
  "CHECK_TURNOVER",
  "CHECK_GOVERNMENT_EXPERIENCE",
  "CHECK_REQUIRED_DOCUMENTS",
  "CHECK_EMD_MSME",
  "IDENTIFY_RISKS",
  "SUMMARIZE_TENDER",
]);

export function isCacheableAskAiAction(action: AskAiAction): boolean {
  return CACHEABLE_ACTIONS.has(action);
}

export async function computeEvidenceHashes(options: {
  companyId: string;
  tenderId: string;
}): Promise<{ tenderEvidenceHash: string; companyEvidenceHash: string }> {
  const supabase = getServerSupabase();

  const [tenderRes, companyRes] = await Promise.all([
    supabase
      .from("agenttender_ai_document_chunks")
      .select("content_hash")
      .eq("tender_id", options.tenderId)
      .eq("source_type", "TENDER_DOCUMENT")
      .eq("is_active", true),
    supabase
      .from("agenttender_ai_document_chunks")
      .select("content_hash")
      .eq("company_id", options.companyId)
      .is("tender_id", null)
      .in("source_type", ["COMPANY_DOCUMENT", "COMPANY_PROFILE"])
      .eq("is_active", true),
  ]);

  // Distinct content hashes (source-level), sorted for stability.
  const tenderHashes = Array.from(
    new Set((tenderRes.data || []).map((r) => String(r.content_hash || ""))),
  );
  const companyHashes = Array.from(
    new Set((companyRes.data || []).map((r) => String(r.content_hash || ""))),
  );

  return {
    tenderEvidenceHash: hashEvidenceVersions(tenderHashes),
    companyEvidenceHash: hashEvidenceVersions(companyHashes),
  };
}

export function buildAskAiCacheKey(parts: {
  companyId: string;
  tenderId: string;
  action: AskAiAction;
  normalizedQuestion: string;
  tenderEvidenceHash: string;
  companyEvidenceHash: string;
  model?: string;
  promptVersion?: string;
  retrievalVersion?: string;
}): string {
  const model = parts.model || getAskAiChatModel();
  const payload = [
    parts.companyId,
    parts.tenderId,
    parts.action,
    parts.normalizedQuestion.trim().toLowerCase(),
    parts.tenderEvidenceHash,
    parts.companyEvidenceHash,
    parts.promptVersion || TENDER_RAG_PROMPT_VERSION,
    parts.retrievalVersion || TENDER_RAG_RETRIEVAL_VERSION,
    model,
  ].join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

export type CachedAskAiAnswer = {
  cacheKey: string;
  answer: string;
  sources: AskAiSource[];
  warnings: string[];
  metadata: Record<string, unknown>;
  model: string;
  promptVersion: string;
  retrievalVersion: string;
};

export async function lookupAskAiCache(
  cacheKey: string,
): Promise<CachedAskAiAnswer | null> {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("agenttender_ai_answer_cache")
      .select(
        "cache_key, answer, sources, warnings, metadata, model, prompt_version, retrieval_version, expires_at",
      )
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return {
      cacheKey: data.cache_key,
      answer: data.answer,
      sources: Array.isArray(data.sources) ? (data.sources as AskAiSource[]) : [],
      warnings: Array.isArray(data.warnings)
        ? (data.warnings as string[])
        : [],
      metadata:
        data.metadata && typeof data.metadata === "object"
          ? (data.metadata as Record<string, unknown>)
          : {},
      model: data.model,
      promptVersion: data.prompt_version,
      retrievalVersion: data.retrieval_version,
    };
  } catch {
    return null;
  }
}

export async function storeAskAiCache(options: {
  companyId: string;
  tenderId: string;
  action: AskAiAction;
  cacheKey: string;
  answer: string;
  sources: AskAiSource[];
  warnings: string[];
  tenderEvidenceHash: string;
  companyEvidenceHash: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!isCacheableAskAiAction(options.action)) return;
  if (!isAskAiAction(options.action) || options.action === "GENERAL") return;

  try {
    const supabase = getServerSupabase();
    const ttl = getAskAiCacheTtlSeconds();
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const now = new Date().toISOString();
    const { error } = await supabase.from("agenttender_ai_answer_cache").upsert(
      {
        company_id: options.companyId,
        tender_id: options.tenderId,
        action: options.action,
        cache_key: options.cacheKey,
        model: getAskAiChatModel(),
        prompt_version: TENDER_RAG_PROMPT_VERSION,
        retrieval_version: TENDER_RAG_RETRIEVAL_VERSION,
        tender_evidence_hash: options.tenderEvidenceHash,
        company_evidence_hash: options.companyEvidenceHash,
        answer: options.answer,
        sources: options.sources,
        warnings: options.warnings,
        metadata: options.metadata || {},
        expires_at: expiresAt,
        updated_at: now,
        created_at: now,
      },
      { onConflict: "cache_key" },
    );
    if (error) {
      console.warn("[AskAI] cache_store_failed", { error: error.message });
    }
  } catch (error) {
    console.warn("[AskAI] cache_store_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Stream a cached answer through the same SSE contract (chunked deltas). */
export function* chunkCachedAnswer(
  answer: string,
  chunkSize = 48,
): Generator<string> {
  if (!answer) return;
  for (let i = 0; i < answer.length; i += chunkSize) {
    yield answer.slice(i, i + chunkSize);
  }
}
