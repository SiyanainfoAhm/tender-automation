import { NextResponse } from "next/server";

import { requireCompanySession } from "@/server/auth/company-access";
import { askTenderAi } from "@/server/tenders/tender-ai-assessment";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireCompanySession();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as {
      message?: unknown;
      conversation?: unknown;
    };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!id || !message) {
      return NextResponse.json({ error: "Tender id and message are required." }, { status: 400 });
    }
    const conversation = Array.isArray(body.conversation)
      ? body.conversation
          .filter((item): item is { role: "user" | "assistant"; content: string } => Boolean(item) && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
          .slice(-6)
      : [];
    const result = await askTenderAi({ tenderId: id, companyId: session.companyId, message, conversation });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to assess this tender.";
    console.error("[tender ask-ai]", error);
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 500 });
  }
}
