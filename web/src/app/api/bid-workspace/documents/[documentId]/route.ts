import { NextResponse } from "next/server";

import { getSession } from "@/server/auth/session";
import { invokeWorkspaceDocumentRead } from "@/server/storage/tenderAutomationDocumentFunctions";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session?.user.companyId) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  const { documentId } = await context.params;
  if (!documentId) {
    return NextResponse.json(
      { success: false, error: "Document id is required." },
      { status: 400 },
    );
  }

  try {
    const upstream = await invokeWorkspaceDocumentRead(documentId);
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    const disposition = upstream.headers.get("content-disposition");
    if (disposition) headers.set("Content-Disposition", disposition);
    headers.set(
      "Cache-Control",
      upstream.ok ? "private, max-age=300" : "no-store",
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    console.error("[bid-workspace] document read proxy failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load workspace document." },
      { status: 500 },
    );
  }
}
