import "server-only";

import type { AiSourceType } from "@/server/ai/rag/types";
import type {
  AskAiAction,
  AskAiRetrievalMeta,
  AskAiSource,
} from "@/lib/ai/ask-ai-stream";

export type { AskAiAction, AskAiRetrievalMeta, AskAiSource };

export type RetrievedChunk = {
  id: string;
  companyId: string | null;
  tenderId: string | null;
  sourceType: AiSourceType;
  sourceId: string;
  documentName: string | null;
  documentUrl: string | null;
  documentType: string | null;
  pageNumber: number | null;
  section: string | null;
  chunkIndex: number;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  /** Combined hybrid score (higher is better). Not exposed to normal UI. */
  score: number;
  vectorSimilarity: number | null;
  ftsRank: number | null;
};

export type EvidenceItem = {
  evidenceId: string;
  chunk: RetrievedChunk;
  excerpt: string;
};

export type AskAiRagReply = {
  answer: string;
  sources: AskAiSource[];
  warnings: string[];
  retrievalMeta?: AskAiRetrievalMeta;
};

/** Hybrid merge weights (documented for Phase 4). */
export const HYBRID_VECTOR_WEIGHT = 0.65;
export const HYBRID_FTS_WEIGHT = 0.35;
/** Drop candidates below this combined score unless they are sole FTS keyword hits. */
export const MIN_COMBINED_SCORE = 0.18;
export const MAX_TENDER_CHUNKS = 8;
export const MAX_COMPANY_CHUNKS = 5;
export const MAX_CONTEXT_TOKENS = 6_000;
export const EXCERPT_CHARS = 420;
