/**
 * On-demand tender indexing when Ask AI finds zero indexed tender chunks.
 *
 * - Uses Phase 3 `indexTenderKnowledge` (no request-time extraction for answers).
 * - Dedupes concurrent starts per tender (in-process).
 * - Does not block the Ask AI HTTP response; client polls status then retries.
 */
import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import { scheduleAiIndexing } from "@/server/ai/rag/schedule-index";
import {
  buildTenderSourceDescriptors,
  indexTenderKnowledge,
} from "@/server/ai/rag/tender-knowledge";
import { getTenderIndexReadiness } from "@/server/ai/rag/index-readiness";

export const ASK_AI_PREPARING_KNOWLEDGE_MESSAGE =
  "Preparing AI knowledge for this tender. This is required only once.";

export const ASK_AI_INDEX_FAILED_MESSAGE =
  "Could not prepare AI knowledge for this tender. Check that tender documents are available, then retry indexing.";

export const ASK_AI_NO_SOURCES_MESSAGE =
  "No tender documents are available to index for this tender yet.";

type InflightEntry = {
  startedAt: number;
  promise: Promise<void>;
};

const inflightByTender = new Map<string, InflightEntry>();
const lastFailureByTender = new Map<
  string,
  { at: number; message: string }
>();

export type OnDemandIndexStartResult =
  | {
      outcome: "started" | "already_running";
      message: string;
    }
  | {
      outcome: "no_sources";
      message: string;
    }
  | {
      outcome: "ready";
      message: string;
    };

export type TenderOnDemandIndexPoll = {
  state: "ready" | "indexing" | "failed" | "none";
  activeChunkCount: number;
  indexedSources: number;
  failedSources: number;
  pendingSources: number;
  inflight: boolean;
  message: string | null;
};

function clearInflight(tenderId: string) {
  inflightByTender.delete(tenderId);
}

/** Test helper. */
export function __resetOnDemandTenderIndexForTests(): void {
  inflightByTender.clear();
  lastFailureByTender.clear();
}

export function __getOnDemandInflightForTests(tenderId: string): boolean {
  return inflightByTender.has(tenderId);
}

async function hasDbIndexingRows(tenderId: string): Promise<boolean> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_ai_document_index_status")
    .select("source_id")
    .eq("tender_id", tenderId)
    .eq("source_type", "TENDER_DOCUMENT")
    .eq("status", "INDEXING")
    .limit(1);
  if (error) {
    console.warn("[ai-rag] on_demand_index_status_check_failed", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Kick off Phase 3 tender indexing if needed. Safe to call repeatedly.
 * Never awaits the full index inside Ask AI — schedules in background.
 */
export async function ensureOnDemandTenderIndexing(options: {
  tenderId: string;
  companyId: string;
  sessionToken?: string | null;
}): Promise<OnDemandIndexStartResult> {
  const readiness = await getTenderIndexReadiness(options.tenderId);
  if (readiness.activeChunkCount > 0 || readiness.indexedSources > 0) {
    return { outcome: "ready", message: "AI knowledge is already available." };
  }

  if (inflightByTender.has(options.tenderId) || (await hasDbIndexingRows(options.tenderId))) {
    return {
      outcome: "already_running",
      message: ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
    };
  }

  const descriptors = await buildTenderSourceDescriptors({
    tenderId: options.tenderId,
    companyId: options.companyId,
  });
  if (descriptors.length === 0) {
    lastFailureByTender.set(options.tenderId, {
      at: Date.now(),
      message: ASK_AI_NO_SOURCES_MESSAGE,
    });
    return { outcome: "no_sources", message: ASK_AI_NO_SOURCES_MESSAGE };
  }

  const startedAt = Date.now();
  const run = async () => {
    try {
      const results = await indexTenderKnowledge({
        tenderId: options.tenderId,
        companyId: options.companyId,
      });
      const anyOk = results.some(
        (row) =>
          row.status === "INDEXED" ||
          row.status === "SKIPPED_UNCHANGED" ||
          (row.chunkCount ?? 0) > 0,
      );
      if (!anyOk) {
        const firstError =
          results.find((row) => row.errorMessage)?.errorMessage ||
          ASK_AI_INDEX_FAILED_MESSAGE;
        lastFailureByTender.set(options.tenderId, {
          at: Date.now(),
          message: firstError.slice(0, 240),
        });
      } else {
        lastFailureByTender.delete(options.tenderId);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : ASK_AI_INDEX_FAILED_MESSAGE;
      lastFailureByTender.set(options.tenderId, {
        at: Date.now(),
        message: message.slice(0, 240),
      });
      console.error("[ai-rag] on_demand_tender_index_failed", {
        tenderId: options.tenderId,
        error: message,
      });
    } finally {
      clearInflight(options.tenderId);
    }
  };

  const promise = new Promise<void>((resolve) => {
    scheduleAiIndexing(
      async () => {
        await run();
        resolve();
      },
      { sessionToken: options.sessionToken },
    );
  });

  inflightByTender.set(options.tenderId, { startedAt, promise });
  return {
    outcome: "started",
    message: ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
  };
}

/** Lightweight poll for UI — does not start indexing. */
export async function pollOnDemandTenderIndex(
  tenderId: string,
): Promise<TenderOnDemandIndexPoll> {
  const readiness = await getTenderIndexReadiness(tenderId);
  const inflight =
    inflightByTender.has(tenderId) || (await hasDbIndexingRows(tenderId));
  const failure = lastFailureByTender.get(tenderId);

  if (readiness.activeChunkCount > 0 || readiness.indexedSources > 0) {
    return {
      state: "ready",
      activeChunkCount: readiness.activeChunkCount,
      indexedSources: readiness.indexedSources,
      failedSources: readiness.failedSources,
      pendingSources: readiness.pendingSources,
      inflight: false,
      message: null,
    };
  }

  if (inflight || readiness.pendingSources > 0) {
    return {
      state: "indexing",
      activeChunkCount: readiness.activeChunkCount,
      indexedSources: readiness.indexedSources,
      failedSources: readiness.failedSources,
      pendingSources: readiness.pendingSources,
      inflight: true,
      message: ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
    };
  }

  if (
    failure &&
    Date.now() - failure.at < 15 * 60_000 &&
    readiness.failedSources > 0
  ) {
    return {
      state: "failed",
      activeChunkCount: readiness.activeChunkCount,
      indexedSources: readiness.indexedSources,
      failedSources: readiness.failedSources,
      pendingSources: readiness.pendingSources,
      inflight: false,
      message: failure.message || ASK_AI_INDEX_FAILED_MESSAGE,
    };
  }

  if (failure && readiness.failedSources === 0 && readiness.indexedSources === 0) {
    // no_sources or hard failure with no status rows
    return {
      state: "failed",
      activeChunkCount: 0,
      indexedSources: 0,
      failedSources: readiness.failedSources,
      pendingSources: readiness.pendingSources,
      inflight: false,
      message: failure.message || ASK_AI_INDEX_FAILED_MESSAGE,
    };
  }

  if (readiness.failedSources > 0 && readiness.indexedSources === 0) {
    return {
      state: "failed",
      activeChunkCount: readiness.activeChunkCount,
      indexedSources: readiness.indexedSources,
      failedSources: readiness.failedSources,
      pendingSources: readiness.pendingSources,
      inflight: false,
      message: ASK_AI_INDEX_FAILED_MESSAGE,
    };
  }

  return {
    state: "none",
    activeChunkCount: readiness.activeChunkCount,
    indexedSources: readiness.indexedSources,
    failedSources: readiness.failedSources,
    pendingSources: readiness.pendingSources,
    inflight: false,
    message: null,
  };
}
