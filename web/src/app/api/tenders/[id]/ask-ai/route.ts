import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { getTenderById } from "@/server/repositories/tenderRepository";
import {
  AskAiValidationError,
  validateAskAiInput,
} from "@/server/ai/rag/input-limits";
import {
  checkAskAiRateLimits,
  releaseAskAiConcurrency,
  waitForAskAiConcurrency,
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
  section?: string | null;
  chunk_id?: string | null;
  source_id?: string | null;
  document_url?: string | null;
};

type V2ChatResponse = {
  ok?: boolean;
  message_id?: string;
  request_id?: string;
  success?: boolean;
  readiness_warnings?: string[];
  route?: string;
  status?: string;
  answer?: string | null;
  evidence?: V2Evidence[];
  company_evidence?: V2Evidence[];
  historical_evidence?: V2Evidence[];
  historical_positive_evidence?: V2Evidence[];
  partial_document_evidence?: boolean;
  model?: string;
  error?: string;
};

function sseErrorResponse(options: {
  code: "RATE_LIMITED" | "CONCURRENT_REQUEST" | "BAD_REQUEST";
  message: string;
  retryable: boolean;
}): Response {
  return new Response(
    encodeSseEvent({
      type: "error",
      code: options.code,
      message: options.message,
      retryable: options.retryable,
    }) + encodeSseEvent({ type: "done" }),
    {
      status: options.code === "BAD_REQUEST" ? 400 : 429,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    },
  );
}

function getV2Config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!url) {
    throw new Error("Orchestrator V2 chat is not configured. SUPABASE_URL is required.");
  }
  return { url };
}

async function callLightV2Chat(options: {
  tenderId: string;
  companyId: string;
  question: string;
  sessionToken: string;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  sessionId?: string;
  questionCategory?: string;
  signal?: AbortSignal;
}): Promise<V2ChatResponse> {
  const { url } = getV2Config();
  const response = await fetch(`${url}/functions/v1/agenttender-db-chat`, {
    method: "POST",
    headers: {
      "x-agenttender-session": options.sessionToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tender_id: options.tenderId,
      company_id: options.companyId,
      message: options.question,
      session_id: options.sessionId,
      question_category: options.questionCategory,
      conversation: options.conversation,
    }),
    cache: "no-store",
    signal: options.signal,
  });

  const payload = (await response.json().catch(() => ({}))) as V2ChatResponse;
  if (!response.ok || payload.ok === false || payload.success === false) {
    throw new Error(
      payload.error || `Lightweight V2 chat failed with HTTP ${response.status}.`,
    );
  }
  return payload;
}

function evidenceToSources(options: {
  tenderId: string;
  companyId: string;
  evidence?: V2Evidence[];
  sourceType: string;
  fallbackName: string;
}): AskAiSource[] {
  return (options.evidence || []).map((item, index) => {
    const ref = item.ref || `${options.sourceType}-${index + 1}`;
    const documentName = item.document || options.fallbackName;
    return {
      id: ref,
      fileName: documentName,
      pageCount: null,
      sourceType: options.sourceType,
      sourceId: item.source_id || item.chunk_id || ref,
      documentUrl: item.document_url && /^https?:\/\//i.test(item.document_url) ? item.document_url : null,
      documentName,
      pageNumber: item.page ?? null,
      section: item.section ?? null,
      tenderId: options.tenderId,
      companyId: options.companyId,
    } satisfies AskAiSource;
  });
}

function mapSources(result: V2ChatResponse, tenderId: string, companyId: string) {
  return [
    ...evidenceToSources({
      tenderId,
      companyId,
      evidence: result.evidence,
      sourceType: "TENDER_DOCUMENT",
      fallbackName: "Tender document",
    }),
    ...evidenceToSources({
      tenderId,
      companyId,
      evidence: result.company_evidence,
      sourceType: "COMPANY_DOCUMENT",
      fallbackName: "Company document",
    }),
    ...evidenceToSources({
      tenderId,
      companyId,
      evidence: result.historical_evidence,
      sourceType: "SUBMITTED_BID_DOCUMENT",
      fallbackName: "Submitted bid evidence",
    }),
    ...evidenceToSources({
      tenderId,
      companyId,
      evidence: result.historical_positive_evidence,
      sourceType: "HISTORICAL_POSITIVE_RFP",
      fallbackName: "Historical positive tender evidence",
    }),
  ];
}

function buildMeta(options: {
  action: AskAiAction;
  startedAt: number;
  result: V2ChatResponse;
  streamed: boolean;
}): AskAiRetrievalMeta {
  return {
    action: options.action,
    messageId: options.result.message_id,
    requestId: options.result.request_id,
    queryEmbeddingMs: 0,
    tenderVectorMs: 0,
    tenderFtsMs: 0,
    companyVectorMs: 0,
    companyFtsMs: 0,
    retrievalTotalMs: 0,
    promptBuildMs: 0,
    llmMs: 0,
    totalMs: Date.now() - options.startedAt,
    tenderChunks: options.result.evidence?.length || 0,
    companyChunks: options.result.company_evidence?.length || 0,
    contextTokensApprox: 0,
    indexStatus: options.result.partial_document_evidence ? "partial" : "ready",
    streamed: options.streamed,
    promptVersion: "ORCHESTRATOR_V2_LIGHT_CHAT",
    retrievalVersion: options.result.route || "ORCHESTRATOR_V2_LIGHT_CHAT",
  };
}

function createSseResponse(options: {
  tenderId: string;
  companyId: string;
  question: string;
  sessionToken: string;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  sessionId?: string;
  questionCategory?: string;
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
      const send = (event: Parameters<typeof encodeSseEvent>[0]) =>
        controller.enqueue(encoder.encode(encodeSseEvent(event)));

      try {
        send({
          type: "status",
          stage: "retrieving",
          message: "Checking tender, company and past-bid evidence...",
        });

        // Keep the stream active while V2 works (detailed checks take 30-60s);
        // idle connections can be dropped by proxies before the answer arrives.
        const waitingMessages = [
          "Reading the tender requirements...",
          "Comparing with Siyana's company documents...",
          "Applying company rules and the V2 evaluation...",
          "Preparing the answer...",
        ];
        let tick = 0;
        const keepAlive = setInterval(() => {
          try {
            send({
              type: "status",
              stage: "retrieving",
              message: waitingMessages[Math.min(tick++, waitingMessages.length - 1)],
            });
          } catch {
            clearInterval(keepAlive);
          }
        }, 8000);
        const result = await callLightV2Chat({
          tenderId: options.tenderId,
          companyId: options.companyId,
          question: options.question,
          sessionToken: options.sessionToken,
          sessionId: options.sessionId,
          questionCategory: options.questionCategory,
          conversation: options.conversation,
          signal: abort.signal,
        }).finally(() => clearInterval(keepAlive));

        if (result.status !== "ANSWERED" || !result.answer) {
          send({
            type: "error",
            code: "INTERNAL_ERROR",
            message: result.error || "V2 chat did not return an answer.",
            retryable: true,
          });
          send({ type: "done" });
          return;
        }

        const sources = mapSources(result, options.tenderId, options.companyId);
        const warnings = result.readiness_warnings || (result.partial_document_evidence
          ? [
              "Current tender evidence is limited. The answer uses available evidence only; no OCR, extraction, indexing or embedding job was started.",
            ]
          : []);

        send({
          type: "status",
          stage: "generating",
          message: "Preparing answer...",
        });
        send({ type: "delta", text: result.answer });
        send({ type: "sources", sources, warnings });
        send({
          type: "done",
          retrievalMeta: buildMeta({
            action: options.action,
            startedAt,
            result,
            streamed: true,
          }),
        });
      } catch (error) {
        send({
          type: "error",
          code: abort.signal.aborted ? "REQUEST_CANCELLED" : "INTERNAL_ERROR",
          message: abort.signal.aborted
            ? "Request cancelled."
            : error instanceof Error
              ? error.message
              : "V2 chat failed.",
          retryable: !abort.signal.aborted,
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
    // Read the same HttpOnly cookie validated by requirePermissionStrict.
    // V2 resolves the user from this session; no request-body user_id is trusted.
    const cookieStore = await cookies();
    const cookieName = process.env.AGENTTENDER_SESSION_COOKIE?.trim() || "agenttender_session";
    const sessionToken = cookieStore.get(cookieName)?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      message?: unknown;
      conversation?: unknown;
      action?: unknown;
      stream?: unknown;
      session_id?: unknown;
      question_category?: unknown;
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
        return sseErrorResponse({ code: "BAD_REQUEST", message, retryable: false });
      }
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (!id) {
      return NextResponse.json({ error: "Tender id is required." }, { status: 400 });
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
          code: rate.code === "CONCURRENT_REQUEST" ? "CONCURRENT_REQUEST" : "RATE_LIMITED",
          message: rate.message,
          retryable: true,
        });
      }
      return NextResponse.json({ error: rate.message, code: rate.code }, { status: 429 });
    }

    // A second request while one is still running waits for it instead of failing.
    const concurrency = await waitForAskAiConcurrency({
      companyId: session.companyId,
      userId: session.user.id,
      signal: request.signal,
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
      return createSseResponse({
        tenderId: id,
        companyId: session.companyId,
        question: validated.message,
        sessionToken,
        conversation: validated.conversation,
        sessionId: typeof body.session_id === "string" ? body.session_id : undefined,
        questionCategory: typeof body.question_category === "string" ? body.question_category : undefined,
        action,
        requestSignal: request.signal,
        release,
      });
    }

    const startedAt = Date.now();
    try {
      const result = await callLightV2Chat({
        tenderId: id,
        companyId: session.companyId,
        question: validated.message,
        sessionToken,
        conversation: validated.conversation,
        sessionId: typeof body.session_id === "string" ? body.session_id : undefined,
        questionCategory: typeof body.question_category === "string" ? body.question_category : undefined,
        signal: request.signal,
      });
      if (result.status !== "ANSWERED" || !result.answer) {
        return NextResponse.json(
          { error: result.error || "V2 chat did not return an answer." },
          { status: 502 },
        );
      }
      return NextResponse.json({
        answer: result.answer,
        warnings: result.readiness_warnings || (result.partial_document_evidence
          ? [
              "Current tender evidence is limited. The answer uses available evidence only; no OCR, extraction, indexing or embedding job was started.",
            ]
          : []),
        sources: mapSources(result, id, session.companyId),
        retrievalMeta: buildMeta({
          action,
          startedAt,
          result,
          streamed: false,
        }),
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
      error instanceof Error ? error.message : "Unable to answer this tender question.";
    console.error("[AskAI:V2LightChat]", { requestId, error: message });
    return NextResponse.json(
      { error: message },
      { status: message.toLowerCase().includes("not found") ? 404 : 500 },
    );
  }
}


