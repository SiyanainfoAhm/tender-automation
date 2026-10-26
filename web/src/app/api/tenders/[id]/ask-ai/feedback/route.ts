import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { CompanyAccessError } from "@/server/auth/company-access";
import { getServerSupabase } from "@/lib/db/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function auth() {
  const token = (await cookies()).get(process.env.AGENTTENDER_SESSION_COOKIE?.trim() || "agenttender_session")?.value;
  if (!token) return null;
  return { token, session: await requirePermissionStrict("tenders.view") };
}
export async function POST(request: Request, context: Context) {
  try {
    const principal = await auth();
    if (!principal) return reply({ error: "Authentication required" }, 401);
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || !uuid.test(id) || !uuid.test(body.message_id || "") || !uuid.test(body.request_id || "") ||
      !["HELPFUL", "UNHELPFUL", "CORRECTION"].includes(body.feedback_type)) return reply({ error: "Invalid feedback" }, 400);
    const correction = typeof body.corrected_answer === "string" ? body.corrected_answer.trim() : "";
    const reason = typeof body.correction_reason === "string" ? body.correction_reason.trim() : "";
    if (correction.length > 8000 || reason.length > 4000 || (body.feedback_type === "CORRECTION" && (!correction || !reason)))
      return reply({ error: "Enter a corrected answer and explain what should change." }, 400);
    const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
    if (!url) return reply({ error: "Feedback service unavailable" }, 503);
    // V2 authenticates the actual user and owns message authorization and verification.
    const response = await fetch(`${url}/functions/v1/agenttender-orch-v2-chat`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-agenttender-session": principal.token },
      body: JSON.stringify({ operation: "SUBMIT_FEEDBACK", tender_id: id, company_id: principal.session.companyId,
        message_id: body.message_id, request_id: body.request_id, feedback_type: body.feedback_type,
        corrected_answer: body.feedback_type === "CORRECTION" ? correction : undefined, correction_reason: reason || undefined }),
      cache: "no-store", signal: request.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true || !result.feedback?.id) return reply({ error: "Feedback could not be saved. Please retry." }, response.ok ? 502 : response.status);
    return reply({ feedback: { id: result.feedback.id, status: result.feedback.status, kind: body.feedback_type } });
  } catch (error) {
    return reply({ error: "Feedback service unavailable" }, error instanceof CompanyAccessError ? 403 : 503);
  }
}
export async function GET(request: Request, context: Context) {
  try {
    const principal = await auth();
    if (!principal) return reply({ error: "Authentication required" }, 401);
    const { id } = await context.params;
    const messageId = new URL(request.url).searchParams.get("message_id") || "";
    if (!uuid.test(id) || !uuid.test(messageId)) return reply({ error: "Invalid feedback request" }, 400);
    const { data, error } = await getServerSupabase().from("agenttender_chat_corrections")
      .select("id,verification_status,feedback_type").eq("message_id", messageId)
      .eq("tender_id", id).eq("company_id", principal.session.companyId).eq("user_id", principal.session.user.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return reply({ error: "Unable to check feedback" }, 503);
    return reply({ feedback: data ? { id: data.id, status: data.verification_status, kind: data.feedback_type } : null });
  } catch (error) {
    return reply({ error: "Unable to check feedback" }, error instanceof CompanyAccessError ? 403 : 503);
  }
}

