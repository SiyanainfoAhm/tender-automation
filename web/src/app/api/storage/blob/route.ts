import { NextResponse } from "next/server";

import { isAzureBlobUrl } from "@/lib/storage/accessible-storage-url";
import { getSession } from "@/server/auth/session";
import { invokeBlobRead } from "@/server/storage/tenderAutomationDocumentFunctions";

/**
 * Authenticated proxy for Azure blobs.
 * Required because the storage account disallows anonymous/public access.
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
  } catch (error) {
    console.error("[storage/blob] proxy failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load file." },
      { status: 500 },
    );
  }
}
