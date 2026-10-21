import { NextResponse } from "next/server";

import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { getTenderById } from "@/server/repositories/tenderRepository";
import {
  AskAiValidationError,
  validateAskAiInput,
} from "@/server/ai/rag/input-limits";
import {
  acquireAskAiConcurrency,
  checkAskAiRateLimits,
  releaseAskAiConcurrency,
} from "@/server/ai/rag/rate-limit";
import {
  createAskAiRequestId,
  insertAiUsageLog,
} from "@/server/ai/rag/usage-log";
import {
  encodeSseEvent,
  type AskAiAction,
  type AskAiRetrievalMeta,
  type AskAiSource,
} from "@/lib/ai/ask-ai-stream";

export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

type V2Evidence = {
  ref?: string;
  document?: string;
  page?: number | null;
};

type V2ChatResponse = {
  ok?: boolean;
  route?: string;
  status?: "ANSWERED" | "PREPARING" | string;
  answer?: string | null;
  readiness?: {
    readiness?: string;
    message?: string | null;
  } | null;
  evidence?: V2Evidence[];
  company_evidence?: V2Evidence[];
  partial_document_evidence?: boolean;
  model?: string;
  reason?: string;
  error?: string;
};

function sseErrorResponse(options: {
  code: "RATE_LIMITED" | "CONCURRENT_REQUEST" | "BAD_REQUEST";
  message: string;
  retryable: boolean;
}): Response {
  const body =
    encodeSseEvent({
      type: "error",
      code: options.code,
      message: options.message,
      retryable: options.retryable,
    }) + encodeSseEvent({ type: "done" });

  return new Response(body, {
    status: options.code === "BAD_REQUEST" ? 400 : 429,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function getV2Config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Orchestrator V2 chat is not configured. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
  }

  return { url, serviceRoleKey };
}

async function callOrchestratorV2Chat(options: {
  tenderId: string;
  companyId: string;
  question: string;
  signal?: AbortSignal;
}): Promise<V2ChatResponse> {
  const { url, serviceRoleKey } = getV2Config();
  const response = await fetch(
    `${url}/functions/v1/agenttender-orch-v2-worker`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "chat",
        tender_id: options.tenderId,
        company_id: options.companyId,
        question: options.question,
      }),
      cache: "no-store",
      signal: options.signal,
    },
  );

  const payload = (await response.json().catch(() => ({}))) as V2ChatResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(
      payload.error ||
        `Orchestrator V2 chat failed with HTTP ${response.status}.`,
    );
  }

  return payload;
}

function mapV2Sources(options: {
  tenderId: string;
  companyId: string;
  tenderEvidence?: V2Evidence[];
  companyEvidence?: V2Evidence[];
}): AskAiSource[] {
  const tenderSources = (options.tenderEvidence || []).map((item, index) => {
    const ref = item.ref || `R${index + 1}`;
    const documentName = item.document || "Tender document";
    return {
      id: ref,
      fileName: documentName,
      pageCount: null,
      sourceType: "TENDER_DOCUMENT",
      sourceId: ref,
      documentName,
      pageNumber: item.page ?? null,
      tenderId: options.tenderId,
      companyId: options.companyId,
    } satisfies AskAiSource;
  });

  const companySources = (options.companyEvidence || []).map((item, index) => {
    const ref = item.ref || `C${index + 1}`;
    const documentName = item.document || "Company record";
    return {
      id: ref,
      fileName: documentName,
      pageCount: null,
      sourceType: "COMPANY_DOCUMENT",
      sourceId: ref,
      documentName,
      pageNumber: item.page ?? null,
      tenderId: options.tenderId,
      companyId: options.companyId,
    } satisfies AskAiSource;
  });

  return [...tenderSources, ...companySources];
}

function buildRetrievalMeta(options: {
  action: AskAiAction;
  startedAt: number;
  result?: V2ChatResponse;
}): AskAiRetrievalMeta {
  const result = options.result;
  const indexStatus =
    result?.status === "PREPARING"
      ? "indexing"
      : result?.partial_document_evidence
        ? "partial"
        : "ready";

  return {
    action: options.action,
    queryEmbeddingMs: 0,
    tenderVectorMs: 0,
    tenderFtsMs: 0,
    companyVectorMs: 0,
    companyFtsMs: 0,
    retrievalTotalMs: 0,
    promptBuildMs: 0,
    llmMs: 0,
    totalMs: Date.now() - options.startedAt,
    tenderChunks: result?.evidence?.length || 0,
    companyChunks: result?.company_evidence?.length || 0,
    contextTokensApprox: 0,
    indexStatus,
    streamed: true,
    promptVersion: "ORCHESTRATOR_V2_CHAT",
    retrievalVersion: result?.route || "ORCHESTRATOR_V2_CHAT",
  };
}

function createV2SseResponse(options: {
  tenderId: string;
  companyId: string;
  question: string;
  action: AskAiAction;
  requestSignal: AbortSignal;
  release: () => void;
}): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const startedAt = Date.now();

  const onDisconnect = () => abort.abort();
  options.requestSignal.addEventListener("abort", onDisconnect, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Parameters<typeof encodeSseEvent>[0]) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event)));
      };

      try {
        send({
          type: "status",
          stage: "retrieving",
          message: "Searching Orchestrator V2 evidence...",
        });

        const result = await callOrchestratorV2Chat({
          tenderId: options.tenderId,
          companyId: options.companyId,
          question: options.question,
          signal: abort.signal,
        });

        if (result.status === "PREPARING") {
          send({
            type: "status",
            stage: "indexing",
            message:
              result.readiness?.message ||
              result.reason ||
              "Preparing Orchestrator V2 evidence for this tender...",
          });
          send({
            type: "done",
            retrievalMeta: buildRetrievalMeta({
              action: options.action,
              startedAt,
              result,
            }),
          });
          return;
        }

        if (result.status !== "ANSWERED" || !result.answer) {
          send({
            type: "error",
            code: "INTERNAL_ERROR",
            message:
              result.error ||
              result.reason ||
              "Orchestrator V2 did not return an answer.",
            retryable: true,
          });
          send({ type: "done" });
          return;
        }

        const sources = mapV2Sources({
          tenderId: options.tenderId,
          companyId: options.companyId,
          tenderEvidence: result.evidence,
          companyEvidence: result.company_evidence,
        });

        const warnings = result.partial_document_evidence
          ? [
              "Orchestrator V2 answered from partial document evidence; verify missing attachments before making a final bid decision.",
            ]
          : [];

        send({
          type: "status",
          stage: "generating",
          message: "Preparing Orchestrator V2 answer...",
        });
        send({ type: "delta", text: result.answer });
        send({ type: "sources", sources, warnings });
        send({
          type: "done",
          retrievalMeta: buildRetrievalMeta({
            action: options.action,
            startedAt,
            result,
          }),
        });
      } catch (error) {
        if (abort.signal.aborted) {
          send({
            type: "error",
            code: "REQUEST_CANCELLED",
            message: "Request cancelled.",
            retryable: false,
          });
          send({ type: "done" });
          return;
        }

        send({
          type: "error",
          code: "INTERNAL_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Orchestrator V2 chat failed.",
          retryable: true,
        });
        send({ type: "done" });
      } finally {
        options.requestSignal.removeEventListener("abort", onDisconnect);
        options.release();
        controller.close();
      }
    },
    cancel() {
      abort.abort();
      options.release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = createAskAiRequestId();
  let concurrencyHeld = false;
  let companyId: string | null = null;
  let userId: string | null = null;

  try {
    const session = await requirePermissionStrict("tenders.view");
    companyId = session.companyId;
    userId = session.user.id;

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      message?: unknown;
      conversation?: unknown;
      action?: unknown;
      stream?: unknown;
    };

    let validated;
    try {
      validated = validateAskAiInput({
        message: body.message,
        conversation: body.conversation,
      });
    } catch (error) {
      const message =
        error instanceof AskAiValidationError
          ? error.message
          : "Invalid Ask AI request.";
      const wantsStream =
        body.stream !== false &&
        (request.headers.get("accept") || "").includes("text/event-stream");

      if (wantsStream) {
        return sseErrorResponse({
          code: "BAD_REQUEST",
          message,
          retryable: false,
        });
      }
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (!id) {
      return NextResponse.json(
        { error: "Tender id and message are required." },
        { status: 400 },
      );
    }

    const tender = await getTenderById(id);
    if (!tender) {
      return NextResponse.json({ error: "Tender not found." }, { status: 404 });
    }

    const action =
      (typeof body.action === "string" && body.action.trim()
        ? body.action.trim()
        : "GENERAL") as AskAiAction;

    const wantsStream =
      body.stream !== false &&
      (request.headers.get("accept") || "").includes("text/event-stream");

    const rate = await checkAskAiRateLimits({
      companyId: session.companyId,
      userId: session.user.id,
      requestId,
      tenderId: id,
    });

    if (!rate.ok) {
      if (wantsStream) {
        return sseErrorResponse({
          code:
            rate.code === "CONCURRENT_REQUEST"
              ? "CONCURRENT_REQUEST"
              : "RATE_LIMITED",
          message: rate.message,
          retryable: true,
        });
      }
      return NextResponse.json(
        { error: rate.message, code: rate.code },
        { status: 429 },
      );
    }

    const concurrency = acquireAskAiConcurrency({
      companyId: session.companyId,
      userId: session.user.id,
    });

    if (!concurrency.ok) {
      await insertAiUsageLog({
        requestId,
        companyId: session.companyId,
        userId: session.user.id,
        tenderId: id,
        action,
        status: "concurrent",
        errorCode: "CONCURRENT_REQUEST",
      });

      if (wantsStream) {
        return sseErrorResponse({
          code: "CONCURRENT_REQUEST",
          message: concurrency.message,
          retryable: true,
        });
      }

      return NextResponse.json(
        { error: concurrency.message, code: concurrency.code },
        { status: 429 },
      );
    }

    concurrencyHeld = true;

    const release = () => {
      if (concurrencyHeld && companyId && userId) {
        releaseAskAiConcurrency({ companyId, userId });
        concurrencyHeld = false;
      }
    };

    if (wantsStream) {
      return createV2SseResponse({
        tenderId: id,
        companyId: session.companyId,
        question: validated.message,
        action,
        requestSignal: request.signal,
        release,
      });
    }

    const startedAt = Date.now();
    try {
      const result = await callOrchestratorV2Chat({
        tenderId: id,
        companyId: session.companyId,
        question: validated.message,
        signal: request.signal,
      });

      const sources = mapV2Sources({
        tenderId: id,
        companyId: session.companyId,
        tenderEvidence: result.evidence,
        companyEvidence: result.company_evidence,
      });

      const retrievalMeta = buildRetrievalMeta({
        action,
        startedAt,
        result,
      });

      if (result.status === "PREPARING") {
        return NextResponse.json({
          answer: null,
          warnings: [
            result.readiness?.message ||
              result.reason ||
              "Preparing Orchestrator V2 evidence for this tender.",
          ],
          sources,
          retrievalMeta,
        });
      }

      if (result.status !== "ANSWERED" || !result.answer) {
        return NextResponse.json(
          {
            error:
              result.error ||
              result.reason ||
              "Orchestrator V2 did not return an answer.",
          },
          { status: 502 },
        );
      }

      return NextResponse.json({
        answer: result.answer,
        warnings: result.partial_document_evidence
          ? [
              "Orchestrator V2 answered from partial document evidence; verify missing attachments before making a final bid decision.",
            ]
          : [],
        sources,
        retrievalMeta,
      });
    } finally {
      release();
    }
  } catch (error) {
    if (concurrencyHeld && companyId && userId) {
      releaseAskAiConcurrency({ companyId, userId });
      concurrencyHeld = false;
    }

    if (error instanceof CompanyAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to assess this tender.";
    console.error("[AskAI:OrchestratorV2]", { requestId, error: message });

    return NextResponse.json(
      { error: message },
      { status: message.toLowerCase().includes("not found") ? 404 : 500 },
    );
  }
}
