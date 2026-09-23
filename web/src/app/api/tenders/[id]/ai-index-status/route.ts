import { NextResponse } from "next/server";

import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { getTenderById } from "@/server/repositories/tenderRepository";
import { pollOnDemandTenderIndex } from "@/server/ai/rag/on-demand-tender-index";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Lightweight Ask AI index readiness poll (does not start indexing or call OpenAI).
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    await requirePermissionStrict("tenders.view");
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Tender id is required." }, { status: 400 });
    }
    const tender = await getTenderById(id);
    if (!tender) {
      return NextResponse.json({ error: "Tender not found." }, { status: 404 });
    }

    const poll = await pollOnDemandTenderIndex(id);
    return NextResponse.json(poll, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message =
      error instanceof Error ? error.message : "Unable to read index status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
