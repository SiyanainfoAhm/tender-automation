import { NextResponse } from "next/server";

import { canManageBidProfileTemplates } from "@/lib/company/types";
import { getSession } from "@/server/auth/session";
import { invokeTemplateAssetRead } from "@/server/storage/tenderAutomationDocumentFunctions";

type RouteContext = {
  params: Promise<{
    templateId: string;
    assetType: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 },
    );
  }
  if (!canManageBidProfileTemplates(session.user.role)) {
    return NextResponse.json(
      { success: false, error: "Forbidden." },
      { status: 403 },
    );
  }

  const { templateId, assetType } = await context.params;
  if (assetType !== "logo" && assetType !== "signatory") {
    return NextResponse.json(
      { success: false, error: "Invalid asset type." },
      { status: 400 },
    );
  }

  try {
    const upstream = await invokeTemplateAssetRead(templateId, assetType);
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    const contentDisposition = upstream.headers.get("content-disposition");
    headers.set(
      "Content-Disposition",
      contentDisposition || "inline",
    );
    headers.set(
      "Cache-Control",
      upstream.ok ? "private, max-age=300" : "no-store",
    );

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    console.error("[templates] asset read proxy failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load template asset." },
      { status: 500 },
    );
  }
}
