import { NextResponse } from "next/server";

import { getServerSupabase } from "@/lib/db/server";
import {
  artifactRunDate,
  buildTenderArtifactPrefix,
  normalizeArtifactPortal,
} from "@/lib/storage/resolveTenderArtifactPath";
import { getSession } from "@/server/auth/session";
import { getWonProjectDocument } from "@/server/repositories/wonProjectRepository";
import { resolveAzureDocumentReference } from "@/server/storage/resolveAzureDocument";
import {
  invokeBlobRead,
  invokeDocumentRead,
} from "@/server/storage/tenderAutomationDocumentFunctions";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

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

  const doc = await getWonProjectDocument(documentId, session.user.companyId);
  if (!doc) {
    return NextResponse.json(
      { success: false, error: "Document not found." },
      { status: 404 },
    );
  }

  const fileName =
    doc.originalName?.trim() || doc.fileName?.trim() || "document";

  const supabase = getServerSupabase();
  const { data: project } = await supabase
    .from("agenttender_won_projects")
    .select("tender_id")
    .eq("id", doc.wonProjectId)
    .eq("company_id", session.user.companyId)
    .maybeSingle();

  const tenderId = project?.tender_id ? String(project.tender_id) : null;

  let tenderDoc:
    | {
        company_document_id: string | null;
        storage_url: string | null;
        file_name: string | null;
        original_name: string | null;
      }
    | null
    | undefined = null;

  if (doc.tenderDocumentId) {
    const { data } = await supabase
      .from("agenttender_tender_documents")
      .select(
        "company_document_id, storage_url, file_name, original_name, company_id",
      )
      .eq("id", doc.tenderDocumentId)
      .maybeSingle();
    if (data && String(data.company_id) === String(session.user.companyId)) {
      tenderDoc = data;
    }
  }

  const { data: tender } = tenderId
    ? await supabase
        .from("agenttender_tenders")
        .select("id, source_portal, source_tender_id, created_at")
        .eq("id", tenderId)
        .maybeSingle()
    : { data: null };

  try {
    let upstream: Response;

    if (tenderDoc?.company_document_id) {
      upstream = await invokeDocumentRead(
        String(tenderDoc.company_document_id),
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
        tenderId: tenderId || doc.wonProjectId,
        sourcePortal: tender?.source_portal
          ? String(tender.source_portal)
          : null,
        sourceTenderId: tender?.source_tender_id
          ? String(tender.source_tender_id)
          : null,
        createdAt: tender?.created_at ? String(tender.created_at) : null,
        companyId: session.user.companyId,
        companyName,
        storedDocumentUrl:
          tenderDoc?.storage_url || doc.storageUrl || null,
        fileName,
        documentId: doc.tenderDocumentId || doc.id,
        companyDocumentId: tenderDoc?.company_document_id
          ? String(tenderDoc.company_document_id)
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

      upstream = await invokeBlobRead({
        storageUrl: resolved.resolved.storageUrl,
        blobName: resolved.resolved.blobName,
        disposition,
        fileName,
        tenderId: tenderId || doc.wonProjectId,
        sourcePortal: tender?.source_portal
          ? String(tender.source_portal)
          : null,
        prefix: prefix || null,
      });
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { success: false, error: "Unable to load file from storage." },
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
    console.error("[won-tenders] document proxy failed", err);
    return NextResponse.json(
      { success: false, error: "Unable to load document." },
      { status: 500 },
    );
  }
}
