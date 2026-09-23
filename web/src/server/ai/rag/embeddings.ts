import "server-only";

import { getOpenAiClient } from "@/server/ingestion/structuredExtract";
import {
  EMBEDDING_DIMENSIONS,
  getEmbeddingModel,
} from "@/server/ai/rag/types";
import { estimateTokensFromText } from "@/server/ai/rag/cost";

const BATCH_SIZE = 64;
const MAX_ATTEMPTS = 4;

export type EmbeddingBatchResult = {
  embeddings: number[][];
  model: string;
  /** Estimated or provider-reported embedding token usage. */
  embeddingTokens: number;
};

/**
 * Batch-embed texts with OpenAI text-embedding-3-small (1536 dims).
 * Retries transient failures with exponential backoff + jitter.
 */
export async function embedTexts(texts: string[]): Promise<EmbeddingBatchResult> {
  if (texts.length === 0) {
    return { embeddings: [], model: getEmbeddingModel(), embeddingTokens: 0 };
  }

  const client = getOpenAiClient();
  if (!client) {
    throw new Error("OPENAI_API_KEY is not configured for embeddings.");
  }

  const model = getEmbeddingModel();
  const embeddings: number[][] = new Array(texts.length);
  let embeddingTokens = 0;

  for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
    const slice = texts.slice(offset, offset + BATCH_SIZE);
    const { vectors, usageTokens } = await embedBatchWithRetry(
      client,
      model,
      slice,
    );
    embeddingTokens += usageTokens;
    for (let i = 0; i < vectors.length; i += 1) {
      const vector = vectors[i];
      if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Invalid embedding dimension ${vector?.length ?? 0}; expected ${EMBEDDING_DIMENSIONS}.`,
        );
      }
      embeddings[offset + i] = vector;
    }
  }

  if (embeddingTokens <= 0) {
    embeddingTokens = texts.reduce(
      (sum, text) => sum + estimateTokensFromText(text),
      0,
    );
  }

  return { embeddings, model, embeddingTokens };
}

async function embedBatchWithRetry(
  client: NonNullable<ReturnType<typeof getOpenAiClient>>,
  model: string,
  input: string[],
): Promise<{ vectors: number[][]; usageTokens: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await client.embeddings.create({
        model,
        input,
      });
      const byIndex = new Map(
        response.data.map((row) => [row.index, row.embedding as number[]]),
      );
      const vectors = input.map((_, index) => {
        const embedding = byIndex.get(index);
        if (!embedding) {
          throw new Error(`Missing embedding for batch index ${index}.`);
        }
        return embedding;
      });
      const usageTokens =
        typeof response.usage?.total_tokens === "number"
          ? response.usage.total_tokens
          : 0;
      return { vectors, usageTokens };
    } catch (error) {
      lastError = error;
      if (!isRetryableEmbeddingError(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      const base = Math.min(8_000, 400 * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 250);
      await sleep(base + jitter);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Embedding request failed.");
}

function isRetryableEmbeddingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const status =
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;
  if (status === 429 || status === 500 || status === 502 || status === 503) {
    return true;
  }
  return (
    message.includes("rate limit") ||
    message.includes("timeout") ||
    message.includes("temporarily") ||
    message.includes("econnreset") ||
    message.includes("fetch failed")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
