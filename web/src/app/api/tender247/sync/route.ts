import { NextResponse } from "next/server";

import { getServerSupabase } from "@/lib/db/server";
import { indiaYesterdayIsoDate, processSavedTender247Response, requestTender247Once, upstreamResponseCanBeProcessed } from "@/server/tender247/sync";
import { tender247UpstreamContractError } from "@/server/tender247/upstreamContract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function requiredSyncConfigurationError(): string | null {
  const modeError = tender247UpstreamContractError();
  if (modeError) return modeError;
  const required = [
    "SUPABASE_URL", "TENDER247_MIRROR_SUPABASE_URL",
    "TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY", "TENDER247_SYNC_SECRET",
    "TENDER247_SYNC_ENDPOINT", "TENDER247_SYNC_UPSTREAM_SECRET",
    "TENDER247_SYNC_COMPANY_ID",
  ];
  if (!process.env.SUPABASE_SECRET_KEY?.trim() && !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is not configured.";
  }
  const missing = required.find((name) => !process.env[name]?.trim());
  if (missing) return `${missing} is not configured.`;
  const canonicalUrl = process.env.SUPABASE_URL!.trim().replace(/\/$/, "");
  const mirrorUrl = process.env.TENDER247_MIRROR_SUPABASE_URL!.trim().replace(/\/$/, "");
  return canonicalUrl === mirrorUrl ? "TENDER247_MIRROR_SUPABASE_URL must point to the separate Tender247 mirror database, not SUPABASE_URL." : null;
}

function authorized(request: Request): boolean {
  const secret = process.env.TENDER247_SYNC_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return Boolean(secret && supplied && supplied === secret);
}

type SyncRequestBody = { resumeRunId?: unknown; scrapedDate?: unknown };

function validIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function resolveTender247SyncDate(body: SyncRequestBody, now = new Date()): {
  requestedDate: string | null; resolvedDate: string; source: "explicit" | "default_ist_yesterday";
} {
  if (body.scrapedDate === undefined) {
    return { requestedDate: null, resolvedDate: indiaYesterdayIsoDate(now), source: "default_ist_yesterday" };
  }
  const requestedDate = typeof body.scrapedDate === "string" ? body.scrapedDate.trim() : "";
  if (!validIsoCalendarDate(requestedDate)) throw new Error("scrapedDate must be a valid YYYY-MM-DD calendar date.");
  return { requestedDate, resolvedDate: requestedDate, source: "explicit" };
}

export async function POST(request: Request) {
  const configurationError = requiredSyncConfigurationError();
  if (configurationError) return NextResponse.json({ ok: false, error: configurationError }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const db = getServerSupabase();
  const body = await request.json().catch(() => ({})) as SyncRequestBody;
  const companyId = process.env.TENDER247_SYNC_COMPANY_ID!.trim();
  const resumeRunId = typeof body.resumeRunId === "string" ? body.resumeRunId.trim() : "";
  if (resumeRunId) return resumeSavedRun(db, resumeRunId, companyId, body.scrapedDate);
  let dateResolution: ReturnType<typeof resolveTender247SyncDate>;
  try { dateResolution = resolveTender247SyncDate(body); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
  const scrapedDate = dateResolution.resolvedDate;
  const initialSummary = {
    scrapedDate, requestedDate: dateResolution.requestedDate, resolvedDate: scrapedDate,
    dateSource: dateResolution.source, intendedProcessingDate: scrapedDate,
    // This is deliberately not an upstream date claim. Tender247 filter and
    // pagination semantics remain unverified until the provider documents them.
    sourceCompleteness: "UNVERIFIED",
    source: "tender247_api", counts: {}, errors: [], rawResponse: null,
  };
  const { data: run, error: lockError } = await db.from("agenttender_pipeline_runs")
    .insert({ company_id: companyId, portal: "TENDER247", run_date: scrapedDate, status: "running", mode: "api_sync", summary: initialSummary })
    .select("id").single();
  if (lockError?.code === "23505") return NextResponse.json({ ok: false, error: "A Tender247 sync is already running." }, { status: 409 });
  if (lockError || !run) {
    const detail = lockError?.message || "The database did not return a sync-run ID.";
    console.error("[tender247-sync] unable to create sync run", {
      code: lockError?.code,
      details: lockError?.details,
      hint: lockError?.hint,
      message: detail,
    });
    return NextResponse.json({ ok: false, error: `Unable to create sync run: ${detail}` }, { status: 500 });
  }
  const runId = run.id;
  console.info("[tender247-sync] processing date resolved", { runId, requestedDate: dateResolution.requestedDate, resolvedDate: scrapedDate, source: dateResolution.source });
  let persistedSummary: Record<string, unknown> = initialSummary;
  try {
    console.info("[tender247-sync] unfiltered feed request starting", { runId, processingDateLabel: scrapedDate, sourceCompleteness: "UNVERIFIED" });
    const response = await requestTender247Once(scrapedDate);
    console.info("[tender247-sync] feed request completed", { runId });
    persistedSummary = { ...initialSummary, rawResponse: response };
    const { error: saveError } = await db.from("agenttender_pipeline_runs").update({ summary: persistedSummary }).eq("id", runId);
    if (saveError) throw new Error(saveError.message || "Unable to persist raw upstream response");
    if (!upstreamResponseCanBeProcessed(response)) throw new Error("Tender247 returned an unsuccessful or rate-limited response; no tender rows were changed.");
    const result = await processSavedTender247Response(response, scrapedDate, { onProgress: (message) => console.info("[tender247-sync]", { runId, message }) });
    await db.from("agenttender_pipeline_runs").update({ status: result.status === "COMPLETED" ? "success" : "completed_with_failures", finished_at: new Date().toISOString(), summary: { ...persistedSummary, ...result.summary } }).eq("id", runId);
    return NextResponse.json({ ok: true, runId, status: result.status, summary: result.summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("agenttender_pipeline_runs").update({ status: "failed", finished_at: new Date().toISOString(), summary: { ...persistedSummary, errors: [message] } }).eq("id", runId);
    return NextResponse.json({ ok: false, runId, error: message }, { status: 500 });
  }
}

async function resumeSavedRun(db: ReturnType<typeof getServerSupabase>, runId: string, companyId: string, requestedScrapedDate: unknown) {
  const { data: run, error } = await db.from("agenttender_pipeline_runs")
    .select("id, company_id, run_date, summary")
    .eq("id", runId).eq("portal", "TENDER247").eq("mode", "api_sync").maybeSingle();
  if (error || !run || run.company_id !== companyId) return NextResponse.json({ ok: false, error: "Saved Tender247 API run not found." }, { status: 404 });
  if (requestedScrapedDate !== undefined) {
    const requestedDate = typeof requestedScrapedDate === "string" ? requestedScrapedDate.trim() : "";
    if (!validIsoCalendarDate(requestedDate)) return NextResponse.json({ ok: false, error: "scrapedDate must be a valid YYYY-MM-DD calendar date." }, { status: 400 });
    if (requestedDate !== String(run.run_date)) {
      return NextResponse.json({ ok: false, error: `Saved run date is ${String(run.run_date)}; refusing to resume it as ${requestedDate}.` }, { status: 409 });
    }
  }
  const summary = run.summary && typeof run.summary === "object" ? run.summary as Record<string, unknown> : {};
  const rawResponse = summary.rawResponse;
  if (!rawResponse || typeof rawResponse !== "object" || Array.isArray(rawResponse)) return NextResponse.json({ ok: false, error: "Saved run has no raw API response to resume." }, { status: 409 });
  const { error: claimedError } = await db.from("agenttender_pipeline_runs").update({ status: "running", finished_at: null }).eq("id", run.id);
  if (claimedError?.code === "23505") return NextResponse.json({ ok: false, error: "A Tender247 sync is already running." }, { status: 409 });
  if (claimedError) return NextResponse.json({ ok: false, error: "Unable to resume saved run." }, { status: 500 });
  try {
    const response = rawResponse as Record<string, unknown>;
    console.info("[tender247-sync] saved processing date reused", { runId: run.id, requestedDate: requestedScrapedDate ?? null, resolvedDate: String(run.run_date), source: "saved_run", sourceCompleteness: "UNVERIFIED" });
    if (!upstreamResponseCanBeProcessed(response)) throw new Error("Saved response was unsuccessful or rate-limited; no tender rows were changed.");
    const result = await processSavedTender247Response(response, String(run.run_date));
    await db.from("agenttender_pipeline_runs").update({ status: result.status === "COMPLETED" ? "success" : "completed_with_failures", finished_at: new Date().toISOString(), summary: { ...summary, ...result.summary } }).eq("id", run.id);
    return NextResponse.json({ ok: true, runId: run.id, resumed: true, status: result.status, summary: result.summary });
  } catch (resumeError) {
    const message = resumeError instanceof Error ? resumeError.message : String(resumeError);
    await db.from("agenttender_pipeline_runs").update({ status: "failed", finished_at: new Date().toISOString(), summary: { ...summary, errors: [message] } }).eq("id", run.id);
    return NextResponse.json({ ok: false, runId: run.id, resumed: true, error: message }, { status: 500 });
  }
}
