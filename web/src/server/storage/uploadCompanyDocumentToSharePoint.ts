import "server-only";

import { MAX_DOCUMENT_UPLOAD_BYTES } from "@/lib/uploads/config";
import { SHAREPOINT_UPLOAD_CHUNK_BYTES } from "@/lib/uploads/directSharePointUpload";
import type { DocumentUploadMetadata, UploadKind } from "@/lib/uploads/types";
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
 * Server-side company library upload via Graph SharePoint session
 * (same flow as browser direct upload; never touches Azure Blob).
 */
export async function uploadCompanyDocumentToSharePoint(options: {
  file: File;
  metadata: DocumentUploadMetadata;
}): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  if (!(options.file instanceof File) || options.file.size <= 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (options.file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    return { ok: false, error: "File exceeds the upload size limit." };
  }

  const created = await invokeCreateDirectUpload({
    purpose: "company-library",
    documentName: options.metadata.name,
    name: options.metadata.name,
    fileName: options.file.name,
    originalFileName: options.file.name,
    mimeType: options.file.type || "application/octet-stream",
    fileSizeBytes: options.file.size,
    notes: options.metadata.notes || null,
    uploadKind: options.metadata.uploadKind || "general",
    category: categoryFromKind(options.metadata.uploadKind),
    certificateType: options.metadata.certificateType || null,
    issuingAuthority: options.metadata.issuingAuthority || null,
    issueDate: options.metadata.issueDate || null,
    expiryDate: options.metadata.expiryDate || null,
    financialYear: options.metadata.financialYear || null,
    documentType: options.metadata.documentType || null,
  });

  const documentId = String(created.documentId || "");
  const storagePath = String(created.blobPath || created.blobName || "");
  if (!created.success || !documentId) {
    return {
      ok: false,
      error: created.error || "Unable to start SharePoint upload.",
    };
  }

  if (!created.duplicate) {
    const uploadUrl = String(created.uploadUrl || "").trim();
    if (!uploadUrl) {
      await invokeAbortDirectUpload({ documentId }).catch(() => null);
      return { ok: false, error: "SharePoint upload session was not created." };
    }
    try {
      for (
        let start = 0;
        start < options.file.size;
        start += SHAREPOINT_UPLOAD_CHUNK_BYTES
      ) {
        const end = Math.min(
          options.file.size,
          start + SHAREPOINT_UPLOAD_CHUNK_BYTES,
        );
        const response = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Range": `bytes ${start}-${end - 1}/${options.file.size}`,
          },
          body: options.file.slice(start, end),
        });
        if (response.status === 409) break;
        if (![200, 201, 202].includes(response.status)) {
          const body = await response.text().catch(() => "");
          await invokeAbortDirectUpload({ documentId }).catch(() => null);
          return {
            ok: false,
            error:
              body.slice(0, 500) ||
              `SharePoint upload failed (${response.status}).`,
          };
        }
      }
    } catch (error) {
      await invokeAbortDirectUpload({ documentId }).catch(() => null);
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "SharePoint upload failed. Please try again.",
      };
    }
  }

  const completed = await invokeCompleteDirectUpload({
    documentId,
    blobPath: storagePath,
    blobName: storagePath,
    fileName: options.file.name,
    originalFileName: options.file.name,
    mimeType: options.file.type || "application/octet-stream",
    fileSizeBytes: options.file.size,
  });
  if (!completed.success) {
    return {
      ok: false,
      error:
        completed.error ||
        "The file reached SharePoint but metadata could not be saved.",
    };
  }

  return { ok: true, documentId: String(completed.documentId || documentId) };
}
