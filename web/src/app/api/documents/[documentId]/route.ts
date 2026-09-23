import { NextResponse } from "next/server";

import {
  isSharePointUrl,
  sharePointRelativePathFromUrl,
} from "@/lib/storage/accessible-storage-url";
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
 * Prefer SharePoint storage_url from the company document column
 * (same pattern as tender artifacts). Never call legacy Azure Blob.
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

  try {
    const supabase = getServerSupabase();
    const { data: doc, error } = await supabase
      .from("agenttender_company_documents")
      .select(
        "id, company_id, status, storage_provider, storage_url, storage_blob_name, original_file_name, name, mime_type",
      )
      .eq("id", documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc || doc.status !== "active") {
      return NextResponse.json(
        { success: false, error: "Document not found." },
        { status: 404 },
      );
    }
    if (String(doc.company_id) !== session.user.companyId) {
      return NextResponse.json(
        {
          success: false,
          error: "You cannot access another company's document.",
        },
        { status: 403 },
      );
    }

    const storageUrl = doc.storage_url ? String(doc.storage_url) : null;
    const fileName =
      (doc.original_file_name as string | null) ||
      (doc.name as string | null) ||
      "document";

    if (isSharePointUrl(storageUrl)) {
      const sharePointPath =
        sharePointRelativePathFromUrl(storageUrl) ||
        (doc.storage_blob_name ? String(doc.storage_blob_name) : undefined);
      const upstream = await invokeBlobRead({
        storageUrl: storageUrl!,
        blobName: sharePointPath,
        disposition,
        fileName,
      });
      const headers = new Headers();
      const contentType = upstream.headers.get("content-type");
      if (contentType) headers.set("Content-Type", contentType);
      const contentLength = upstream.headers.get("content-length");
      if (contentLength) headers.set("Content-Length", contentLength);
      const contentDisposition = upstream.headers.get("content-disposition");
      if (contentDisposition) {
        headers.set("Content-Disposition", contentDisposition);
      }
      headers.set(
        "Cache-Control",
        upstream.ok ? "private, max-age=300" : "no-store",
      );
      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    }

    if (
      doc.storage_provider === "sharepoint" ||
      (doc.storage_blob_name &&
        String(doc.storage_blob_name).includes("/companydocs/"))
    ) {
      const upstream = await invokeDocumentRead(documentId, disposition);
      const headers = new Headers();
      const contentType = upstream.headers.get("content-type");
      if (contentType) headers.set("Content-Type", contentType);
      const contentLength = upstream.headers.get("content-length");
      if (contentLength) headers.set("Content-Length", contentLength);
      const contentDisposition = upstream.headers.get("content-disposition");
      if (contentDisposition) {
        headers.set("Content-Disposition", contentDisposition);
      }
      headers.set(
        "Cache-Control",
        upstream.ok ? "private, max-age=300" : "no-store",
      );
      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    }

    return NextResponse.json(
      {
        success: false,
        code: "AZURE_STORAGE_RETIRED",
        error:
          "This document is on legacy Azure storage which is no longer reachable. Re-upload it to Company Documents.",
      },
      { status: 410 },
    );
  } catch (error) {
    console.error("[documents] read proxy failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load document." },
      { status: 500 },
    );
  }
}
