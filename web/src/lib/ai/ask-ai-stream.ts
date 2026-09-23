/**
 * Shared Ask AI SSE event contract (client + server).
 *
 * Wire format (text/event-stream):
 *   event: <type>\n
 *   data: <json>\n
 *   \n
 *
 * Types: status | delta | sources | done | error
 */

export type AskAiAction =
  | "GENERAL"
  | "ASSESS_TENDER"
  | "CHECK_ELIGIBILITY"
  | "CHECK_SIMILAR_EXPERIENCE"
  | "CHECK_TURNOVER"
  | "CHECK_GOVERNMENT_EXPERIENCE"
  | "CHECK_REQUIRED_DOCUMENTS"
  | "CHECK_EMD_MSME"
  | "IDENTIFY_RISKS"
  | "SUMMARIZE_TENDER";

export type AskAiSource = {
  id?: string;
  fileName: string;
  pageCount: number | null;
  unavailable?: boolean;
  sourceType?: string;
  sourceId?: string;
  documentName?: string | null;
  documentUrl?: string | null;
  pageNumber?: number | null;
  section?: string | null;
  excerpt?: string;
  tenderId?: string | null;
  companyId?: string | null;
};

export type AskAiRetrievalMeta = {
  action: AskAiAction;
  queryEmbeddingMs: number;
  tenderVectorMs: number;
  tenderFtsMs: number;
  companyVectorMs: number;
  companyFtsMs: number;
  retrievalTotalMs: number;
  promptBuildMs: number;
  llmMs: number;
  totalMs: number;
  tenderChunks: number;
  companyChunks: number;
  contextTokensApprox: number;
  indexStatus: "ready" | "partial" | "none" | "indexing" | "failed";
  llmFirstTokenMs?: number;
  streamed?: boolean;
  /** Development / smoke only — never required by UI. */
  cacheHit?: boolean;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  promptVersion?: string;
  retrievalVersion?: string;
};

export type AskAiStreamStage = "retrieving" | "generating" | "indexing";

export type AskAiStreamErrorCode =
  | "RETRIEVAL_TIMEOUT"
  | "MODEL_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "RATE_LIMIT"
  | "RATE_LIMITED"
  | "CONCURRENT_REQUEST"
  | "MODEL_RATE_LIMIT"
  | "MODEL_ERROR"
  | "INDEX_NOT_READY"
  | "INDEXING"
  | "INDEX_FAILED"
  | "PARTIAL_INDEX"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR"
  | "UNKNOWN_ERROR";

export type AskAiStreamEvent =
  | {
      type: "status";
      stage: AskAiStreamStage;
      message: string;
    }
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "sources";
      sources: AskAiSource[];
      warnings: string[];
    }
  | {
      type: "done";
      retrievalMeta?: AskAiRetrievalMeta;
    }
  | {
      type: "error";
      code: AskAiStreamErrorCode;
      message: string;
      retryable: boolean;
    };

export function encodeSseEvent(event: AskAiStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseSseChunk(
  buffer: string,
): { events: AskAiStreamEvent[]; rest: string } {
  const events: AskAiStreamEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";

  for (const part of parts) {
    if (!part.trim()) continue;
    let dataLine = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("data:")) {
        dataLine += line.slice(5).trimStart();
      }
    }
    if (!dataLine) continue;
    try {
      const parsed = JSON.parse(dataLine) as AskAiStreamEvent;
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        events.push(parsed);
      }
    } catch {
      // ignore malformed frames
    }
  }

  return { events, rest };
}
