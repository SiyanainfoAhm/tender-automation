import { NextResponse } from "next/server";

import { getServerSupabase } from "@/lib/db/server";
import {
  artifactRunDate,
  buildTenderArtifactPrefix,
  normalizeArtifactPortal,
} from "@/lib/storage/resolveTenderArtifactPath";
import { getSession } from "@/server/auth/session";
import { resolveAzureDocumentReference } from "@/server/storage/resolveAzureDocument";
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
      "id, company_id, tender_id, file_name, original_name, storage_url, company_document_id",
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

  const { data: tender } = await supabase
    .from("agenttender_tenders")
    .select("id, source_portal, source_tender_id, created_at")
    .eq("id", String(doc.tender_id))
    .maybeSingle();

  try {
    let upstream: Response;
    if (doc.company_document_id) {
      upstream = await invokeDocumentRead(
        String(doc.company_document_id),
        disposition,
      );
    } else {
      const companyName =
        process.env.COMPANY_NAME?.trim() || "Siyana Info Solutions Pvt. Ltd.";
      const portal = normalizeArtifactPortal(
        tender?.source_portal ? String(tender.source_portal) : null,
      );
      const prefix =
        tender?.source_tender_id &&
        (portal === "manual" || portal === "tender247" || portal === "bidassist")
          ? buildTenderArtifactPrefix({
              companyName,
              companyId: session.user.companyId,
              sourcePortal: portal,
              sourceTenderId: String(tender.source_tender_id),
              runDate: artifactRunDate(
                tender.created_at ? String(tender.created_at) : null,
              ),
            })
          : "";

      const resolved = await resolveAzureDocumentReference({
        tenderId: String(doc.tender_id),
        sourcePortal: tender?.source_portal
          ? String(tender.source_portal)
          : null,
        sourceTenderId: tender?.source_tender_id
          ? String(tender.source_tender_id)
          : null,
        createdAt: tender?.created_at ? String(tender.created_at) : null,
        companyId: session.user.companyId,
        companyName,
        storedDocumentUrl: doc.storage_url ? String(doc.storage_url) : null,
        fileName,
        documentId: String(doc.id),
        companyDocumentId: doc.company_document_id
          ? String(doc.company_document_id)
          : null,
      });

      if (!resolved.ok) {
        const status =
          resolved.code === "AZURE_BLOB_NOT_FOUND" ||
          resolved.code === "DOCUMENT_URL_MISSING"
            ? 404
            : resolved.code === "AZURE_PATH_RESOLUTION_FAILED"
              ? 400
              : 502;
        return NextResponse.json(
          {
            success: false,
            code: resolved.code,
            error: resolved.error,
          },
          { status },
        );
      }

      // Prefer exact resolved URL going forward (fixes legacy null storage_url rows).
      if (
        resolved.resolved.storageUrl &&
        resolved.resolved.storageUrl !== doc.storage_url
      ) {
        await supabase
          .from("agenttender_tender_documents")
          .update({ storage_url: resolved.resolved.storageUrl })
          .eq("id", documentId)
          .eq("company_id", session.user.companyId);
      }

      upstream = await invokeBlobRead({
        storageUrl: resolved.resolved.storageUrl,
        blobName: resolved.resolved.blobName,
        disposition,
        fileName,
        tenderId: String(doc.tender_id),
        sourcePortal: tender?.source_portal
          ? String(tender.source_portal)
          : null,
        prefix: prefix || null,
      });
    }

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
      {
        success: false,
        code: "AZURE_DOWNLOAD_FAILED",
        error: "Unable to load file.",
      },
      { status: 500 },
    );
  }
}
