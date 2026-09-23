import { NextResponse } from "next/server";

import { ensureOnDemandTenderIndexing } from "@/server/ai/rag/on-demand-tender-index";
import { createAskAiRequestId } from "@/server/ai/rag/usage-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Internal: index a tender after agent/manual artifact upload.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (or ?secret=)
 *
 * Body JSON:
 *   { tenderId: string, companyId?: string }
 *
 * Uses AI_INDEX_SESSION_TOKEN on the server for SharePoint reads when set.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const header = request.headers.get("authorization") || "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer && bearer === secret) return true;

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret")?.trim();
  return Boolean(querySecret && querySecret === secret);
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    tenderId?: unknown;
    companyId?: unknown;
  };
  const tenderId =
    typeof body.tenderId === "string" ? body.tenderId.trim() : "";
  const companyId =
    (typeof body.companyId === "string" && body.companyId.trim()) ||
    process.env.COMPANY_ID?.trim() ||
    process.env.SIYANA_COMPANY_ID?.trim() ||
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  if (!tenderId) {
    return NextResponse.json(
      { ok: false, error: "tenderId is required." },
      { status: 400 },
    );
  }

  const requestId = createAskAiRequestId();
  const sessionToken = process.env.AI_INDEX_SESSION_TOKEN?.trim() || null;

  try {
    const result = await ensureOnDemandTenderIndexing({
      tenderId,
      companyId,
      sessionToken,
      requestId,
    });

    console.info("[AIIndex]", {
      stage: "AGENT_TRIGGER",
      tenderId,
      companyId,
      status: result.outcome,
      requestId,
      errorCode: null,
    });

    return NextResponse.json({
      ok: true,
      tenderId,
      companyId,
      outcome: result.outcome,
      message: result.message,
      requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[AIIndex]", {
      stage: "AGENT_TRIGGER",
      tenderId,
      companyId,
      status: "FAILED",
      errorCode: message.slice(0, 200),
      requestId,
    });
    return NextResponse.json(
      { ok: false, error: message, requestId },
      { status: 500 },
    );
  }
}
