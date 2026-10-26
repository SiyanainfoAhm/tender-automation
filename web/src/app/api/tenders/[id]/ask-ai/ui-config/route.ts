import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { CompanyAccessError } from "@/server/auth/company-access";
import { getTenderById } from "@/server/repositories/tenderRepository";
import { parseSmartQuestions } from "@/lib/ai/tender-chat-ui";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const token = (await cookies()).get(process.env.AGENTTENDER_SESSION_COOKIE?.trim() || "agenttender_session")?.value;
    if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const session = await requirePermissionStrict("tenders.view");
    const { id } = await context.params;
    if (!await getTenderById(id)) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
    if (!url) throw new Error("Chat configuration unavailable");
    const response = await fetch(`${url}/functions/v1/agenttender-chat-ui`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-agenttender-session": token },
      body: JSON.stringify({ tender_id: id, company_id: session.companyId }), cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) return NextResponse.json({ error: "Unable to load tender questions" }, { status: response.ok ? 502 : response.status });
    return NextResponse.json({ smart_questions: parseSmartQuestions(data.smart_questions), revision: data.revision }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Unable to load tender questions" }, { status: error instanceof CompanyAccessError ? 403 : 503 });
  }
}

