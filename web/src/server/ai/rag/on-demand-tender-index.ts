/**
 * On-demand tender indexing when Ask AI finds zero indexed tender chunks.
 *
 * Authoritative lifecycle state lives in Postgres
 * (`agenttender_ai_tender_index_jobs` + per-source index_status).
 * In-process Maps are never used for poll answers (Vercel multi-isolate safe).
 */
import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import { scheduleAiIndexing } from "@/server/ai/rag/schedule-index";
import {
  buildTenderSourceDescriptors,
  indexTenderKnowledge,
} from "@/server/ai/rag/tender-knowledge";
import { getTenderIndexReadiness } from "@/server/ai/rag/index-readiness";
import { upsertIndexStatus } from "@/server/ai/rag/index-status-repository";
import type { IndexableSourceDescriptor } from "@/server/ai/rag/types";

export const ASK_AI_PREPARING_KNOWLEDGE_MESSAGE =
  "Preparing AI knowledge for this tender. This is required only once.";

export const ASK_AI_INDEX_FAILED_MESSAGE =
  "Could not prepare AI knowledge for this tender. Check that tender documents are available, then retry indexing.";

export const ASK_AI_NO_SOURCES_MESSAGE =
  "No tender documents are available to index for this tender yet.";

/** Stale QUEUED/INDEXING jobs older than this are treated as failed. */
const STALE_JOB_MS = 12 * 60_000;

export type TenderIndexJobStatus =
  | "QUEUED"
  | "INDEXING"
  | "READY"
  | "FAILED"
  | "NO_DOCUMENTS";

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
  state: "ready" | "indexing" | "failed" | "none" | "no_documents";
  activeChunkCount: number;
  indexedSources: number;
  failedSources: number;
  pendingSources: number;
  inflight: boolean;
  jobStatus: TenderIndexJobStatus | null;
  message: string | null;
};

type JobRow = {
  tender_id: string;
  company_id: string;
  status: TenderIndexJobStatus;
  source_count: number;
  error_message: string | null;
  last_stage: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

function logJob(
  stage: string,
  payload: Record<string, unknown>,
) {
  console.info("[AIIndex]", {
    stage,
    tenderId: payload.tenderId ?? null,
    sourceCount: payload.sourceCount ?? payload.source_count ?? null,
    sourceIds: payload.sourceIds ?? null,
    status: payload.status ?? payload.jobStatus ?? payload.outcome ?? null,
    errorCode: payload.errorCode ?? payload.error ?? null,
    durationMs: payload.durationMs ?? payload.total_ms ?? null,
    ...payload,
  });
}

async function getJob(tenderId: string): Promise<JobRow | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_ai_tender_index_jobs")
    .select("*")
    .eq("tender_id", tenderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as JobRow | null) ?? null;
}

async function upsertJob(options: {
  tenderId: string;
  companyId: string;
  status: TenderIndexJobStatus;
  sourceCount?: number;
  requestId?: string | null;
  errorMessage?: string | null;
  lastStage?: string | null;
  markStarted?: boolean;
  markFinished?: boolean;
}): Promise<void> {
  const supabase = getServerSupabase();
  const now = new Date().toISOString();
  const existing = await getJob(options.tenderId);

  const payload: Record<string, unknown> = {
    tender_id: options.tenderId,
    company_id: options.companyId,
    status: options.status,
    source_count:
      options.sourceCount === undefined
        ? existing?.source_count ?? 0
        : options.sourceCount,
    request_id:
      options.requestId === undefined
        ? undefined
        : options.requestId,
    error_message:
      options.errorMessage === undefined
        ? existing?.error_message ?? null
        : options.errorMessage,
    last_stage:
      options.lastStage === undefined
        ? existing?.last_stage ?? null
        : options.lastStage,
    updated_at: now,
  };

  if (!existing) {
    payload.requested_at = now;
    payload.created_at = now;
  } else if (
    options.status === "QUEUED" ||
    (options.status === "INDEXING" && existing.status !== "INDEXING")
  ) {
    payload.requested_at = now;
  }

  if (options.markStarted || options.status === "INDEXING") {
    payload.started_at = existing?.started_at || now;
  }
  if (options.markFinished) {
    payload.finished_at = now;
  }
  if (options.status === "QUEUED") {
    payload.finished_at = null;
    payload.started_at = null;
    payload.error_message = null;
  }

  // Remove undefined keys for supabase upsert
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }

  const { error } = await supabase
    .from("agenttender_ai_tender_index_jobs")
    .upsert(payload, { onConflict: "tender_id" });
  if (error) throw new Error(error.message);
}

function isActiveJob(job: JobRow | null): boolean {
  if (!job) return false;
  if (job.status !== "QUEUED" && job.status !== "INDEXING") return false;
  const anchor = Date.parse(job.updated_at || job.requested_at);
  if (!Number.isFinite(anchor)) return true;
  return Date.now() - anchor < STALE_JOB_MS;
}

async function markSourcesIndexing(
  descriptors: IndexableSourceDescriptor[],
): Promise<void> {
  for (const descriptor of descriptors) {
    await upsertIndexStatus({
      companyId: descriptor.companyId,
      tenderId: descriptor.tenderId,
      sourceType: descriptor.sourceType,
      sourceId: descriptor.sourceId,
      documentName: descriptor.documentName,
      documentUrl: descriptor.documentUrl,
      status: "INDEXING",
      errorMessage: null,
    });
  }
}

/**
 * Kick off Phase 3 tender indexing if needed.
 * Persists QUEUED/INDEXING to Postgres BEFORE scheduling background work.
 */
export async function ensureOnDemandTenderIndexing(options: {
  tenderId: string;
  companyId: string;
  sessionToken?: string | null;
  requestId?: string | null;
}): Promise<OnDemandIndexStartResult> {
  const readiness = await getTenderIndexReadiness(options.tenderId);
  if (readiness.activeChunkCount > 0 || readiness.indexedSources > 0) {
    await upsertJob({
      tenderId: options.tenderId,
      companyId: options.companyId,
      status: "READY",
      sourceCount: readiness.indexedSources,
      lastStage: "INDEXED",
      markFinished: true,
      errorMessage: null,
    });
    return { outcome: "ready", message: "AI knowledge is already available." };
  }

  const existingJob = await getJob(options.tenderId);
  if (isActiveJob(existingJob)) {
    logJob("REQUESTED", {
      tenderId: options.tenderId,
      outcome: "already_running",
      jobStatus: existingJob?.status,
    });
    return {
      outcome: "already_running",
      message: ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
    };
  }

  logJob("REQUESTED", {
    tenderId: options.tenderId,
    companyId: options.companyId,
    requestId: options.requestId ?? null,
  });

  logJob("SOURCE_DISCOVERY", { tenderId: options.tenderId, phase: "start" });
  const descriptors = await buildTenderSourceDescriptors({
    tenderId: options.tenderId,
    companyId: options.companyId,
  });
  logJob("SOURCE_DISCOVERY", {
    tenderId: options.tenderId,
    sourceCount: descriptors.length,
    sourceIds: descriptors.map((d) => d.sourceId),
    status: descriptors.length === 0 ? "NO_DOCUMENTS" : "DISCOVERED",
  });

  if (descriptors.length === 0) {
    await upsertJob({
      tenderId: options.tenderId,
      companyId: options.companyId,
      status: "NO_DOCUMENTS",
      sourceCount: 0,
      requestId: options.requestId,
      errorMessage: ASK_AI_NO_SOURCES_MESSAGE,
      lastStage: "SOURCE_DISCOVERY",
      markFinished: true,
    });
    logJob("SOURCE_DISCOVERY", {
      tenderId: options.tenderId,
      sourceCount: 0,
      sourceIds: [],
      status: "NO_DOCUMENTS",
      errorCode: "INDEX_NO_DOCUMENTS",
    });
    return { outcome: "no_sources", message: ASK_AI_NO_SOURCES_MESSAGE };
  }

  // Durable state BEFORE returning Ask AI / scheduling background work.
  await upsertJob({
    tenderId: options.tenderId,
    companyId: options.companyId,
    status: "QUEUED",
    sourceCount: descriptors.length,
    requestId: options.requestId,
    lastStage: "REQUESTED",
    errorMessage: null,
  });
  await markSourcesIndexing(descriptors);
  logJob("REQUESTED", {
    tenderId: options.tenderId,
    sourceCount: descriptors.length,
    sourceIds: descriptors.map((d) => d.sourceId),
    status: "INDEXING",
  });
  await upsertJob({
    tenderId: options.tenderId,
    companyId: options.companyId,
    status: "INDEXING",
    sourceCount: descriptors.length,
    requestId: options.requestId,
    lastStage: "QUEUED",
    markStarted: true,
    errorMessage: null,
  });

  const run = async () => {
    try {
      await upsertJob({
        tenderId: options.tenderId,
        companyId: options.companyId,
        status: "INDEXING",
        lastStage: "FETCHING",
        markStarted: true,
      });
      logJob("FETCHING", { tenderId: options.tenderId, phase: "start" });

      // indexDocumentSource logs extract/chunk/embed/write per source.
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
      const after = await getTenderIndexReadiness(options.tenderId);
      if (anyOk || after.activeChunkCount > 0) {
        await upsertJob({
          tenderId: options.tenderId,
          companyId: options.companyId,
          status: "READY",
          sourceCount: after.indexedSources || descriptors.length,
          lastStage: "INDEXED",
          markFinished: true,
          errorMessage: null,
        });
        logJob("INDEXED", {
          tenderId: options.tenderId,
          activeChunkCount: after.activeChunkCount,
          indexedSources: after.indexedSources,
        });
        return;
      }

      const firstError =
        results.find((row) => row.errorMessage)?.errorMessage ||
        ASK_AI_INDEX_FAILED_MESSAGE;
      await upsertJob({
        tenderId: options.tenderId,
        companyId: options.companyId,
        status: "FAILED",
        lastStage: "FAILED",
        markFinished: true,
        errorMessage: firstError.slice(0, 500),
      });
      logJob("FAILED", {
        tenderId: options.tenderId,
        error: firstError.slice(0, 200),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : ASK_AI_INDEX_FAILED_MESSAGE;
      await upsertJob({
        tenderId: options.tenderId,
        companyId: options.companyId,
        status: "FAILED",
        lastStage: "FAILED",
        markFinished: true,
        errorMessage: message.slice(0, 500),
      }).catch((upsertError) => {
        console.error("[ai-rag-index-job] FAILED_STATUS_WRITE", {
          tenderId: options.tenderId,
          error:
            upsertError instanceof Error
              ? upsertError.message
              : String(upsertError),
        });
      });
      logJob("FAILED", {
        tenderId: options.tenderId,
        error: message.slice(0, 200),
      });
    }
  };

  // Continue after the Ask AI response via Next after()/waitUntil when available.
  scheduleAiIndexing(run, { sessionToken: options.sessionToken });

  logJob("REQUESTED", {
    tenderId: options.tenderId,
    outcome: "started",
    sourceCount: descriptors.length,
  });

  return {
    outcome: "started",
    message: ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
  };
}

/** Lightweight poll for UI — Postgres only (no in-memory authority). */
export async function pollOnDemandTenderIndex(
  tenderId: string,
): Promise<TenderOnDemandIndexPoll> {
  const [readiness, job] = await Promise.all([
    getTenderIndexReadiness(tenderId),
    getJob(tenderId),
  ]);

  const base = {
    activeChunkCount: readiness.activeChunkCount,
    indexedSources: readiness.indexedSources,
    failedSources: readiness.failedSources,
    pendingSources: readiness.pendingSources,
    jobStatus: (job?.status as TenderIndexJobStatus | undefined) ?? null,
  };

  if (readiness.activeChunkCount > 0 || readiness.indexedSources > 0) {
    return {
      ...base,
      state: "ready",
      inflight: false,
      message: null,
    };
  }

  if (job?.status === "NO_DOCUMENTS") {
    return {
      ...base,
      state: "no_documents",
      inflight: false,
      message: job.error_message || ASK_AI_NO_SOURCES_MESSAGE,
    };
  }

  if (job?.status === "FAILED") {
    return {
      ...base,
      state: "failed",
      inflight: false,
      message: job.error_message || ASK_AI_INDEX_FAILED_MESSAGE,
    };
  }

  if (job && (job.status === "QUEUED" || job.status === "INDEXING")) {
    if (!isActiveJob(job)) {
      // Stale background work — surface failure so UI can Retry Indexing.
      await upsertJob({
        tenderId,
        companyId: job.company_id,
        status: "FAILED",
        lastStage: "FAILED",
        markFinished: true,
        errorMessage:
          "Indexing timed out or did not complete. Please retry indexing.",
      }).catch(() => undefined);
      return {
        ...base,
        state: "failed",
        jobStatus: "FAILED",
        inflight: false,
        message: "Indexing timed out or did not complete. Please retry indexing.",
      };
    }
    return {
      ...base,
      state: "indexing",
      inflight: true,
      message: ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
    };
  }

  // Per-source INDEXING/NOT_INDEXED/NEEDS_REINDEX without a job row (upload path).
  if (readiness.pendingSources > 0) {
    return {
      ...base,
      state: "indexing",
      inflight: true,
      message: ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
    };
  }

  if (readiness.failedSources > 0 && readiness.indexedSources === 0) {
    return {
      ...base,
      state: "failed",
      inflight: false,
      message: ASK_AI_INDEX_FAILED_MESSAGE,
    };
  }

  return {
    ...base,
    state: "none",
    inflight: false,
    message: null,
  };
}

/** Test helper — no in-memory maps remain as authority. */
export function __resetOnDemandTenderIndexForTests(): void {
  // Intentionally empty: durable state is Postgres-only.
}

export function __getOnDemandInflightForTests(_tenderId: string): boolean {
  return false;
}
