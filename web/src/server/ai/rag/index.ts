import "server-only";

export { chunkText, normalizeText, countTokens } from "@/server/ai/rag/chunking";
export { embedTexts } from "@/server/ai/rag/embeddings";
export {
  indexDocumentSource,
  excludeDocumentSource,
} from "@/server/ai/rag/document-ingestion";
export {
  indexTenderKnowledge,
  indexTenderDocumentById,
  indexTenderPortalZip,
  buildTenderSourceDescriptors,
} from "@/server/ai/rag/tender-knowledge";
export {
  indexCompanyKnowledge,
  indexCompanyDocument,
  indexCompanyDocumentInventory,
  indexCompanyProfile,
  buildCompanyDocumentInventoryText,
  buildCompanyProfileText,
} from "@/server/ai/rag/company-knowledge";
export { scheduleAiIndexing } from "@/server/ai/rag/schedule-index";
export {
  ensureOnDemandTenderIndexing,
  pollOnDemandTenderIndex,
  ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
} from "@/server/ai/rag/on-demand-tender-index";
export { askTenderAiRag, prepareTenderRagRequest, generateTenderRagAnswer } from "@/server/ai/rag/ask-ai-rag";
export { streamTenderRagAnswer, createAskAiSseResponse } from "@/server/ai/rag/stream-ask-ai";
export { getAskAiChatModel } from "@/server/ai/rag/prompts";
export {
  TENDER_RAG_PROMPT_VERSION,
  TENDER_RAG_RETRIEVAL_VERSION,
} from "@/server/ai/rag/config";
export { getAskAiDailyUsage, getAskAiMonthlyUsage } from "@/server/ai/rag/usage-reports";
export { getTenderIndexHealth } from "@/server/ai/rag/index-health";
export type {
  AiSourceType,
  AiIndexStatusValue,
  IndexSourceResult,
  IndexableSourceDescriptor,
} from "@/server/ai/rag/types";
export type {
  AskAiAction,
  AskAiRagReply,
  AskAiSource,
  RetrievedChunk,
} from "@/server/ai/rag/retrieval-types";
