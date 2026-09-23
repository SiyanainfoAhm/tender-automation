import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { MAX_DOCUMENT_UPLOAD_BYTES } from "@/lib/uploads/config";
import type { DocumentUploadMetadata, UploadKind } from "@/lib/uploads/types";
import {
  jsonError,
  requireDocumentUploader,
} from "@/server/uploads/requireDocumentUploader";
import {
  invokeAbortDirectUpload,
  invokeCompleteDirectUpload,
  invokeCreateDirectUpload,
} from "@/server/storage/tenderAutomationDocumentFunctions";

function categoryFromKind(kind: UploadKind | string | undefined): string {
  const k = String(kind || "general").toLowerCase();
  if (k === "certificate") return "Certificate";
  if (k === "financial") return "Financial";
  return "General";
}

/**
 * Company Documents library — browser → SharePoint (same pattern as tender docs).
 * Never routes file bytes through Azure Blob.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireDocumentUploader();
    if (auth.error) return auth.error;

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const intent = String(body.intent || "").trim().toLowerCase();

    if (intent === "abort") {
      const documentId = String(body.documentId || "").trim();
      if (!documentId) return jsonError("documentId is required.", 400);
      const aborted = await invokeAbortDirectUpload({ documentId });
      if (!aborted.success) {
        return jsonError(aborted.error || "Unable to abort upload.", 500);
      }
      return NextResponse.json({ success: true, documentId });
    }

    if (intent === "create") {
      const fileName = String(body.fileName || body.originalFileName || "").trim();
      const mimeType = String(body.mimeType || "application/octet-stream");
      const fileSizeBytes = Number(body.fileSizeBytes);
      const metadata = body as Partial<DocumentUploadMetadata> & {
        name?: string;
        uploadKind?: UploadKind;
      };
      const documentName = String(metadata.name || fileName).trim();
      if (!documentName) return jsonError("Document name is required.", 400);
      if (!fileName) return jsonError("fileName is required.", 400);
      if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
        return jsonError("fileSizeBytes is required.", 400);
      }
      if (fileSizeBytes > MAX_DOCUMENT_UPLOAD_BYTES) {
        return jsonError("File exceeds the upload size limit.", 400);
      }

      const created = await invokeCreateDirectUpload({
        purpose: "company-library",
        documentName,
        name: documentName,
        fileName,
        originalFileName: fileName,
        mimeType,
        fileSizeBytes,
        notes: metadata.notes || null,
        uploadKind: metadata.uploadKind || "general",
        category: categoryFromKind(metadata.uploadKind),
        certificateType: metadata.certificateType || null,
        issuingAuthority: metadata.issuingAuthority || null,
        issueDate: metadata.issueDate || null,
        expiryDate: metadata.expiryDate || null,
        financialYear: metadata.financialYear || null,
        documentType: metadata.documentType || null,
      });

      if (!created.success || !created.documentId) {
        return jsonError(
          created.error || "Unable to start SharePoint upload.",
          created.status && created.status >= 400 ? created.status : 500,
        );
      }

      return NextResponse.json({
        success: true,
        documentId: created.documentId,
        blobPath: created.blobPath || created.blobName,
        blobName: created.blobName || created.blobPath,
        uploadUrl: created.uploadUrl || null,
        storageUrl: created.storageUrl || null,
        expiresAt: created.expiresAt || null,
        duplicate: Boolean(created.duplicate),
      });
    }

    if (intent === "complete") {
      const documentId = String(body.documentId || "").trim();
      const blobPath = String(body.blobPath || body.blobName || "").trim();
      const fileName = String(body.fileName || body.originalFileName || "").trim();
      const mimeType = String(body.mimeType || "application/octet-stream");
      const fileSizeBytes = Number(body.fileSizeBytes);
      if (!documentId) return jsonError("documentId is required.", 400);
      if (!blobPath) return jsonError("blobPath is required.", 400);

      const completed = await invokeCompleteDirectUpload({
        documentId,
        blobPath,
        blobName: blobPath,
        fileName,
        originalFileName: fileName,
        mimeType,
        fileSizeBytes,
      });
      if (!completed.success) {
        return jsonError(
          completed.error ||
            "The file reached SharePoint but metadata could not be saved.",
          completed.status && completed.status >= 400 ? completed.status : 500,
        );
      }

      revalidatePath("/documents");
      revalidatePath("/dashboard");
      return NextResponse.json({
        success: true,
        documentId: completed.documentId || documentId,
        storageUrl: completed.storageUrl || null,
        message: "Document uploaded to Company Documents.",
      });
    }

    return jsonError("intent must be create, complete, or abort.", 400);
  } catch (error) {
    console.error("[documents/direct-upload]", error);
    return jsonError(
      error instanceof Error ? error.message : "Unable to process upload.",
      500,
    );
  }
}
