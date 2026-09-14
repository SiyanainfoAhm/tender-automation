import { NextResponse } from "next/server";

import { sendAllCompaniesPendingRefundReminders } from "@/server/bid-fees/pending-refund-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Weekly (or custom) cron endpoint for pending refund reminders.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (or ?secret=)
 * Schedule: configure externally (Vercel Cron, GitHub Actions, etc.) via
 * CRON / env — day/time is not managed in-app.
 *
 * Env:
 * - CRON_SECRET (required to invoke)
 * - POWER_AUTOMATE_EMAIL_URL
 * - TENDERFLOW_APP_URL
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

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

async function run(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET is not configured. Set it to enable pending-refund reminder cron.",
      },
      { status: 503 },
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await sendAllCompaniesPendingRefundReminders();
    const sent = summary.results.reduce((n, r) => n + r.sent, 0);
    const failed = summary.results.reduce((n, r) => n + r.failed, 0);
    const feeCount = summary.results.reduce((n, r) => n + r.feeCount, 0);

    return NextResponse.json({
      ok: failed === 0,
      companies: summary.companies,
      feeCount,
      sent,
      failed,
      results: summary.results,
    });
  } catch (error) {
    console.error("[cron/pending-refund-reminders]", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to send pending refund reminders.",
      },
      { status: 500 },
    );
  }
}
