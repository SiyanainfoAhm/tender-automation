import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import type { TenderDocumentSection } from "@/lib/bid-fees";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "@/lib/uploads/config";
import { validateDocumentFile } from "@/lib/uploads/validation";
import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import {
  insertTenderDocument,
} from "@/server/repositories/bidFeeRepository";
import { getTenderById } from "@/server/repositories/tenderRepository";
import {
  invokeAbortDirectUpload,
  invokeCompleteDirectUpload,
  invokeCreateDirectUpload,
} from "@/server/storage/tenderAutomationDocumentFunctions";

type RouteContext = { params: Promise<{ id: string }> };

const SECTIONS = new Set(["tender", "bidding", "financial", "deliverable"]);

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function applyManualArtifactFields(
  payload: Record<string, unknown>,
  tender: Record<string, unknown> | null | undefined,
) {
  if (!tender) return;
  const portal = String(tender.source_portal || "").toUpperCase();
  if (portal !== "MANUAL") return;
  const sourceId = String(tender.source_tender_id || tender.id || "").trim();
  if (!sourceId) return;
  const createdRaw = String(
    tender.created_at || tender.first_seen_at || "",
  ).trim();
  const createdDate = /^\d{4}-\d{2}-\d{2}/.test(createdRaw)
    ? createdRaw.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  payload.tenderArtifactPortal = "MANUAL";
  payload.tenderArtifactId = sourceId;
  payload.tenderArtifactDate = createdDate;
}

function revalidate(tenderId: string) {
  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/tenders");
  revalidatePath("/bid-fees");
  revalidatePath("/dashboard");
}

/** Issue a short-lived write-only Azure SAS URL (JSON only — no file bytes). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    const { id: tenderId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return jsonError("Invalid JSON body.", 400);

    const intent = String(body.intent || "create").trim();
    if (intent === "complete") {
      return completeDirectUpload(session, tenderId, body);
    }
    if (intent === "abort") {
      return abortDirectUpload(session, tenderId, body);
    }

    const section = String(body.section || "").trim() as TenderDocumentSection;
    const fileName = String(body.fileName || body.originalFileName || "").trim();
    const mimeType = String(body.mimeType || "application/octet-stream");
    const fileSizeBytes = Number(body.fileSizeBytes);
    const feeId = String(body.feeId || "").trim() || null;

    if (!SECTIONS.has(section)) return jsonError("Invalid document section.");
    if (section === "financial" && !feeId) {
      return jsonError(
        "Select or create a fee before uploading financial documents.",
      );
    }

    const fakeFile = {
      name: fileName,
      size: fileSizeBytes,
      type: mimeType,
    } as File;
    const validation = validateDocumentFile(fakeFile, MAX_DOCUMENT_UPLOAD_BYTES);
    if (validation) return jsonError(validation.message, 400);

    const tenderLookup = await getTenderById(tenderId);
    if (!tenderLookup) return jsonError("Tender not found.", 404);

    const payload: Record<string, unknown> = {
      tenderId,
      section,
      feeId,
      fileName,
      originalFileName: fileName,
      documentName: fileName,
      mimeType,
      fileSizeBytes,
      notes: `tender:${tenderId}|section:${section}${feeId ? `|fee:${feeId}` : ""}`,
    };
    applyManualArtifactFields(payload, tenderLookup.tender);

    const created = await invokeCreateDirectUpload(payload);
    if (!created.success || !created.documentId || !created.uploadUrl) {
      return jsonError(
        created.error || "Unable to start direct upload.",
        created.status || 500,
      );
    }

    return NextResponse.json({
      success: true,
      documentId: created.documentId,
      blobPath: created.blobPath || created.blobName,
      blobName: created.blobName || created.blobPath,
      storageUrl: created.storageUrl,
      uploadUrl: created.uploadUrl,
      expiresAt: created.expiresAt,
      headers: created.headers || {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": mimeType || "application/octet-stream",
      },
      maxBytes: MAX_DOCUMENT_UPLOAD_BYTES,
    });
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return jsonError(error.message, 403);
    }
    console.error("[tenders/direct-upload] create failed", error);
    return jsonError(
      error instanceof Error ? error.message : "Unable to start upload.",
      500,
    );
  }
}

async function completeDirectUpload(
  session: Awaited<ReturnType<typeof requirePermissionStrict>>,
  tenderId: string,
  body: Record<string, unknown>,
) {
  const section = String(body.section || "").trim() as TenderDocumentSection;
  const documentId = String(body.documentId || "").trim();
  const blobPath = String(body.blobPath || body.blobName || "").trim();
  const fileName = String(body.fileName || body.originalFileName || "").trim();
  const mimeType = String(body.mimeType || "application/octet-stream");
  const fileSizeBytes = Number(body.fileSizeBytes);
  const feeId = String(body.feeId || "").trim() || null;

  if (!documentId || !blobPath) {
    return jsonError("documentId and blobPath are required.");
  }
  if (!SECTIONS.has(section)) return jsonError("Invalid document section.");

  const completed = await invokeCompleteDirectUpload({
    documentId,
    blobPath,
    blobName: blobPath,
    mimeType,
    fileSizeBytes,
    originalFileName: fileName,
    fileName,
  });

  if (!completed.success || !completed.documentId) {
    // Metadata failed after Azure put — attempt cleanup of pending row/blob.
    console.error("[tenders/direct-upload] metadata save failed", {
      tenderId,
      documentId,
      blobPath,
      error: completed.error,
    });
    await invokeAbortDirectUpload({ documentId }).catch((cleanupError) => {
      console.error("[tenders/direct-upload] orphan cleanup failed", {
        tenderId,
        documentId,
        blobPath,
        message:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    });
    return jsonError(
      completed.error ||
        "The file reached Azure but could not be saved. Please try again.",
      completed.status || 500,
    );
  }

  try {
    await insertTenderDocument({
      companyId: session.companyId,
      tenderId,
      section,
      entityType: feeId ? "fee" : "manual",
      entityId: feeId,
      feeId,
      companyDocumentId: completed.documentId,
      fileName,
      originalName: fileName,
      mimeType: mimeType || null,
      fileSizeBytes: Number.isFinite(fileSizeBytes) ? fileSizeBytes : null,
      storageProvider: "azure",
      storageUrl:
        typeof completed.storageUrl === "string" ? completed.storageUrl : null,
      userId: session.user.id,
    });
  } catch (error) {
    console.error("[tenders/direct-upload] tender document insert failed", {
      tenderId,
      documentId: completed.documentId,
      blobPath,
      message: error instanceof Error ? error.message : String(error),
    });
    await invokeAbortDirectUpload({ documentId: completed.documentId }).catch(
      () => null,
    );
    return jsonError(
      "The file was uploaded but the tender document record could not be saved.",
      500,
    );
  }

  revalidate(tenderId);
  return NextResponse.json({
    success: true,
    documentId: completed.documentId,
    message: "Document uploaded.",
  });
}

async function abortDirectUpload(
  _session: Awaited<ReturnType<typeof requirePermissionStrict>>,
  tenderId: string,
  body: Record<string, unknown>,
) {
  const documentId = String(body.documentId || "").trim();
  if (!documentId) return jsonError("documentId is required.");
  const aborted = await invokeAbortDirectUpload({ documentId });
  if (!aborted.success) {
    console.error("[tenders/direct-upload] abort failed", {
      tenderId,
      documentId,
      error: aborted.error,
    });
    return jsonError(aborted.error || "Unable to abort upload.", aborted.status || 500);
  }
  return NextResponse.json({ success: true, documentId });
}
