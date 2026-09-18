import { NextResponse } from "next/server";

import {
  isSharePointUrl,
  sharePointRelativePathFromUrl,
} from "@/lib/storage/accessible-storage-url";
import { unwrapStoredDocumentReference } from "@/lib/storage/parseAzureBlobUrl";
import { getSession } from "@/server/auth/session";
import { invokeBlobRead } from "@/server/storage/tenderAutomationDocumentFunctions";

/**
 * Authenticated proxy for tender artifact downloads (SharePoint only).
 * documents_zip_url / ai_summary_url / document_urls point at SharePoint;
 * Azure is not used for these artifacts.
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
        error: "A valid document storage URL is required.",
      },
      { status: 400 },
    );
  }

  if (!isSharePointUrl(storageUrl)) {
    return NextResponse.json(
      {
        success: false,
        code: "SHAREPOINT_URL_REQUIRED",
        error:
          "Tender document downloads use SharePoint only. Update documents_zip_url / document_urls to a SharePoint URL.",
      },
      { status: 400 },
    );
  }

  const sharePointPath = sharePointRelativePathFromUrl(storageUrl);

  console.log("[Document Storage Resolve]", {
    storedDocumentUrl: storageUrl,
    blobName: sharePointPath,
    provider: "sharepoint",
  });

  try {
    const upstream = await invokeBlobRead({
      storageUrl,
      blobName: sharePointPath || undefined,
      disposition: download ? "attachment" : "inline",
      fileName,
    });

    if (!upstream.ok) {
      const contentType = upstream.headers.get("content-type") || "";
      let message = "Unable to load file from SharePoint.";
      let code = "SHAREPOINT_FILE_NOT_FOUND";
      if (contentType.includes("application/json")) {
        const body = (await upstream.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        if (body?.error) message = body.error;
        if (body?.code) code = body.code;
      }
      return NextResponse.json(
        { success: false, code, error: message },
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
    } else if (download && fileName) {
      headers.set(
        "Content-Disposition",
        `attachment; filename="${fileName.replace(/"/g, "")}"`,
      );
    }
    headers.set("Cache-Control", "private, max-age=300");

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error("[storage/blob] SharePoint proxy failed", error);
    return NextResponse.json(
      {
        success: false,
        code: "DOCUMENT_DOWNLOAD_FAILED",
        error: "Unable to load file from SharePoint.",
      },
      { status: 500 },
    );
  }
}
