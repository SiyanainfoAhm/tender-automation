import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { getTenderById } from "@/server/repositories/tenderRepository";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requirePermissionStrict("tenders.view");
    const { id: tenderId } = await context.params;
    if (!tenderId) {
      return NextResponse.json({ error: "Tender id is required." }, { status: 400 });
    }

    const tender = await getTenderById(tenderId);
    if (!tender) {
      return NextResponse.json({ error: "Tender not found." }, { status: 404 });
    }

    const cookieStore = await cookies();
    const cookieName = process.env.AGENTTENDER_SESSION_COOKIE?.trim() || "agenttender_session";
    const sessionToken = cookieStore.get(cookieName)?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
    if (!url) {
      return NextResponse.json({ error: "Ask AI configuration is unavailable." }, { status: 503 });
    }

    const response = await fetch(`${url}/functions/v1/agenttender-chat-ui`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agenttender-session": sessionToken,
      },
      body: JSON.stringify({ tender_id: tenderId, company_id: session.companyId }),
      cache: "no-store",
    });
    const config = await response.json().catch(() => ({}));
    if (!response.ok || config.ok !== true) {
      return NextResponse.json(
        { error: config.error || "V2 chat configuration could not be loaded." },
        { status: response.status || 502 },
      );
    }

    const questions = Array.isArray(config.smart_questions)
      ? config.smart_questions.filter(
          (item: unknown) =>
            item &&
            typeof item === "object" &&
            typeof (item as { category?: unknown }).category === "string" &&
            typeof (item as { label?: unknown }).label === "string" &&
            typeof (item as { question?: unknown }).question === "string",
        )
      : [];

    return NextResponse.json(
      {
        title: typeof config.title === "string" ? config.title : "VBDC Tender Assistant",
        subtitle: typeof config.subtitle === "string" ? config.subtitle : "",
        smart_questions: questions,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : "Unable to load V2 chat configuration.";
    console.error("[AskAI:V2ChatUI]", { error: message });
    return NextResponse.json({ error: "Unable to load V2 chat configuration." }, { status: 500 });
  }
}
