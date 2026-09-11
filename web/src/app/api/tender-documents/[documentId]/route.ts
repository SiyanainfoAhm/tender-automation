import { NextResponse } from "next/server";

import { getServerSupabase } from "@/lib/db/server";
import { getSession } from "@/server/auth/session";
import {
  invokeBlobRead,
  invokeDocumentRead,
} from "@/server/storage/tenderAutomationDocumentFunctions";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

/**
 * Authenticated tender-document download.
 * Prefer this over exposing raw Azure URLs in the browser
 * (`/api/storage/blob?url=https://…blob.core.windows.net…`).
 */
export async function GET(request: Request, context: RouteContext) {
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

  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const disposition = download ? "attachment" : "inline";

  const supabase = getServerSupabase();
  const { data: doc, error } = await supabase
    .from("agenttender_tender_documents")
    .select(
      "id, company_id, file_name, original_name, storage_url, company_document_id",
    )
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    console.error("[tender-documents] lookup failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load document." },
      { status: 500 },
    );
  }
  if (!doc || String(doc.company_id) !== String(session.user.companyId)) {
    return NextResponse.json(
      { success: false, error: "Document not found." },
      { status: 404 },
    );
  }

  const fileName =
    (typeof doc.original_name === "string" && doc.original_name.trim()) ||
    (typeof doc.file_name === "string" && doc.file_name.trim()) ||
    "document";

  try {
    let upstream: Response;
    if (doc.company_document_id) {
      upstream = await invokeDocumentRead(
        String(doc.company_document_id),
        disposition,
      );
    } else if (doc.storage_url) {
      upstream = await invokeBlobRead({
        storageUrl: String(doc.storage_url),
        disposition,
        fileName,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: "No file is linked to this document. Upload it again.",
        },
        { status: 404 },
      );
    }

    if (!upstream.ok) {
      const contentType = upstream.headers.get("content-type") || "";
      let message =
        "File not found in storage. Re-upload this tender document.";
      if (contentType.includes("application/json")) {
        const body = (await upstream.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (body?.error) message = body.error;
      }
      return NextResponse.json(
        { success: false, error: message },
        { status: upstream.status === 404 ? 404 : 502 },
      );
    }

    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    const contentDisposition = upstream.headers.get("content-disposition");
    if (contentDisposition) {
      headers.set("Content-Disposition", contentDisposition);
    } else {
      headers.set(
        "Content-Disposition",
        `${disposition}; filename="${fileName.replace(/"/g, "")}"`,
      );
    }
    headers.set("Cache-Control", "private, max-age=300");

    return new Response(upstream.body, { status: 200, headers });
  } catch (err) {
    console.error("[tender-documents] proxy failed", err);
    return NextResponse.json(
      { success: false, error: "Unable to load file." },
      { status: 500 },
    );
  }
}
