import { NextResponse } from "next/server";

import { isAzureBlobUrl } from "@/lib/storage/accessible-storage-url";
import {
  tryParseAzureBlobUrl,
  unwrapStoredDocumentReference,
} from "@/lib/storage/parseAzureBlobUrl";
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
  const rawUrl = requestUrl.searchParams.get("url")?.trim() || "";
  const download = requestUrl.searchParams.get("download") === "1";
  const fileName = requestUrl.searchParams.get("fileName")?.trim() || null;
  const storageUrl = unwrapStoredDocumentReference(rawUrl);

  if (!storageUrl) {
    return NextResponse.json(
      {
        success: false,
        code: "DOCUMENT_URL_MISSING",
        error: "A valid Azure blob url is required.",
      },
      { status: 400 },
    );
  }

  const defaultContainer =
    process.env.TENDER_AUTOMATION_AZURE_STORAGE_CONTAINER_NAME?.trim() ||
    "companydocuments";
  const parsed = tryParseAzureBlobUrl(storageUrl, {
    defaultContainer,
  });

  // Relative blob paths are allowed; full non-Azure URLs are rejected.
  if (!parsed && !isAzureBlobUrl(storageUrl)) {
    return NextResponse.json(
      {
        success: false,
        code: "AZURE_PATH_RESOLUTION_FAILED",
        error: "The stored document path could not be resolved in Azure.",
      },
      { status: 400 },
    );
  }

  console.log("[Azure Document Resolve]", {
    tenderId: null,
    sourcePortal: null,
    storedDocumentUrl: storageUrl,
    containerName: parsed?.containerName || defaultContainer,
    blobName: parsed?.blobName || null,
  });

  try {
    const upstream = await invokeBlobRead({
      storageUrl: isAzureBlobUrl(storageUrl) ? storageUrl : undefined,
      blobName: parsed?.blobName,
      disposition: download ? "attachment" : "inline",
      fileName,
    });

    if (!upstream.ok) {
      const contentType = upstream.headers.get("content-type") || "";
      let message = "Unable to load file from Azure storage.";
      let code: string | undefined;
      if (contentType.includes("application/json")) {
        const body = (await upstream.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        if (body?.error) message = body.error;
        if (body?.code) code = body.code;
      } else if (upstream.status === 404) {
        code = "AZURE_BLOB_NOT_FOUND";
        message =
          "File not found in Azure storage at the resolved path. Re-upload the document only if this blob was never uploaded.";
      }
      return NextResponse.json(
        { success: false, ...(code ? { code } : {}), error: message },
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
      {
        success: false,
        code: "AZURE_DOWNLOAD_FAILED",
        error: "Unable to load file.",
      },
      { status: 500 },
    );
  }
}
