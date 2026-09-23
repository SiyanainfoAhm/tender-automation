import { NextResponse } from "next/server";

import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import {
  createAskAiSseResponse,
  streamTenderRagAnswer,
} from "@/server/ai/rag/stream-ask-ai";
import { askTenderAi } from "@/server/tenders/tender-ai-assessment";
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
import { createAskAiRequestId, insertAiUsageLog } from "@/server/ai/rag/usage-log";
import { encodeSseEvent } from "@/lib/ai/ask-ai-stream";
import { peekDocumentSessionToken } from "@/server/storage/tenderAutomationDocumentFunctions";

export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

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
    }) +
    encodeSseEvent({
      type: "done",
    });
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
      typeof body.action === "string" ? body.action.trim() : null;

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
        action: action || "GENERAL",
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

    const sessionToken = await peekDocumentSessionToken();

    const release = () => {
      if (concurrencyHeld && companyId && userId) {
        releaseAskAiConcurrency({ companyId, userId });
        concurrencyHeld = false;
      }
    };

    // Primary production path: RAG + SSE streaming.
    if (wantsStream) {
      const abort = new AbortController();
      const onDisconnect = () => abort.abort();
      request.signal.addEventListener("abort", onDisconnect, { once: true });
      abort.signal.addEventListener("abort", release, { once: true });

      const generator = (async function* () {
        try {
          yield* streamTenderRagAnswer({
            tenderId: id,
            companyId: session.companyId,
            userId: session.user.id,
            requestId,
            message: validated.message,
            conversation: validated.conversation,
            action,
            signal: abort.signal,
            sessionToken,
          });
        } finally {
          release();
        }
      })();

      return createAskAiSseResponse(generator, { abort });
    }

    // Non-stream JSON still uses indexed RAG (no SharePoint at question time).
    try {
      const result = await askTenderAi({
        tenderId: id,
        companyId: session.companyId,
        message: validated.message,
        conversation: validated.conversation,
        action,
        sessionToken,
      });
      return NextResponse.json(result);
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
    console.error("[AskAI]", { requestId, error: message });
    return NextResponse.json(
      { error: message },
      { status: message.toLowerCase().includes("not found") ? 404 : 500 },
    );
  }
}
