import "server-only";

/**
 * Non-stream Ask AI entrypoint — always RAG (Phase 9).
 * Streaming is the primary production path via streamTenderRagAnswer.
 */

import { askTenderAiRag } from "@/server/ai/rag/ask-ai-rag";
import type { AskAiSource } from "@/server/ai/rag/retrieval-types";

export type TenderAiReply = {
  answer: string;
  sources: AskAiSource[];
  warnings: string[];
  retrievalMeta?: AskAiRagReplyMeta;
};

type AskAiRagReplyMeta = NonNullable<
  Awaited<ReturnType<typeof askTenderAiRag>>["retrievalMeta"]
>;

/** Server-only grounded Ask AI call (indexed RAG only — no SharePoint at question time). */
export async function askTenderAi(options: {
  tenderId: string;
  companyId: string;
  message: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  action?: string | null;
  sessionToken?: string | null;
}): Promise<TenderAiReply> {
  const message = options.message.trim();
  if (!message) throw new Error("A question is required.");
  return askTenderAiRag(options);
}
