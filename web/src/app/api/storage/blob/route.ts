import { NextResponse } from "next/server";

import { isAzureBlobUrl } from "@/lib/storage/accessible-storage-url";
import { getSession } from "@/server/auth/session";
import { invokeBlobRead } from "@/server/storage/tenderAutomationDocumentFunctions";

/**
 * Authenticated proxy for Azure blobs.
 * Required because the storage account disallows anonymous/public access.
 *
 * Prefer `/api/tender-documents/{id}` or `/api/documents/{id}` for app documents.
 * This route remains for portal archive URLs (documents_zip_url / ai_summary_url).
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user.companyId) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  const requestUrl = new URL(request.url);
  const storageUrl = requestUrl.searchParams.get("url")?.trim() || "";
  const download = requestUrl.searchParams.get("download") === "1";
  const fileName = requestUrl.searchParams.get("fileName")?.trim() || null;

  if (!storageUrl || !isAzureBlobUrl(storageUrl)) {
    return NextResponse.json(
      { success: false, error: "A valid Azure blob url is required." },
      { status: 400 },
    );
  }

  try {
    const upstream = await invokeBlobRead({
      storageUrl,
      disposition: download ? "attachment" : "inline",
      fileName,
    });

    if (!upstream.ok) {
      const contentType = upstream.headers.get("content-type") || "";
      let message =
        "File not found in Azure storage. Re-upload the document or re-run the crawler archive upload.";
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
    }
    headers.set("Cache-Control", "private, max-age=300");

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("[storage/blob] proxy failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load file." },
      { status: 500 },
    );
  }
}
