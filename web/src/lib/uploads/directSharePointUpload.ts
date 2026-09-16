import { MAX_DOCUMENT_UPLOAD_BYTES } from "@/lib/uploads/config";
import { validateDocumentFile } from "@/lib/uploads/validation";
import type { TenderDocumentSection } from "@/lib/bid-fees";

export type DirectUploadResult =
  | { ok: true; documentId: string; message?: string }
  | { ok: false; error: string };

type CreateUploadResponse = {
  success?: boolean;
  error?: string;
  documentId?: string;
  blobPath?: string;
  blobName?: string;
  uploadUrl?: string | null;
  storageUrl?: string | null;
  expiresAt?: string | null;
  duplicate?: boolean;
};

// Graph fragments must be a multiple of 320 KiB and below 60 MiB.
export const SHAREPOINT_UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024;

async function abortUpload(tenderId: string, documentId: string): Promise<void> {
  await fetch(
    `/api/tenders/${encodeURIComponent(tenderId)}/documents/direct-upload`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "abort", documentId }),
    },
  ).catch(() => null);
}

async function uploadChunks(options: {
  uploadUrl: string;
  file: File;
  signal?: AbortSignal;
}): Promise<{ ok: true; duplicate?: boolean } | { ok: false; error: string }> {
  for (
    let start = 0;
    start < options.file.size;
    start += SHAREPOINT_UPLOAD_CHUNK_BYTES
  ) {
    const end = Math.min(
      options.file.size,
      start + SHAREPOINT_UPLOAD_CHUNK_BYTES,
    );
    const response = await fetch(options.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${start}-${end - 1}/${options.file.size}`,
      },
      body: options.file.slice(start, end),
      signal: options.signal,
    });
    // 202 = more ranges expected; 200/201 = driveItem created.
    if (response.status === 409) {
      return { ok: true, duplicate: true };
    }
    if (![200, 201, 202].includes(response.status)) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error:
          body.slice(0, 500) ||
          `SharePoint upload failed (${response.status}).`,
      };
    }
  }
  return { ok: true };
}

/**
 * Browser → SharePoint upload without sending file bytes through Vercel.
 * The server creates a Microsoft Graph upload session after checking for an
 * existing file; the browser sends Graph-compatible chunks and then asks the
 * server to persist the SharePoint webUrl.
 */
export async function uploadTenderDocumentDirectToSharePoint(options: {
  tenderId: string;
  section: TenderDocumentSection;
  file: File;
  feeId?: string | null;
  signal?: AbortSignal;
}): Promise<DirectUploadResult> {
  const validation = validateDocumentFile(
    options.file,
    MAX_DOCUMENT_UPLOAD_BYTES,
  );
  if (validation) return { ok: false, error: validation.message };

  const endpoint =
    `/api/tenders/${encodeURIComponent(options.tenderId)}/documents/direct-upload`;
  const createRes = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "create",
      section: options.section,
      feeId: options.feeId || null,
      fileName: options.file.name,
      originalFileName: options.file.name,
      mimeType: options.file.type || "application/octet-stream",
      fileSizeBytes: options.file.size,
    }),
    signal: options.signal,
  });
  const created =
    (await createRes.json().catch(() => ({}))) as CreateUploadResponse;
  if (!createRes.ok || !created.success || !created.documentId) {
    return {
      ok: false,
      error: created.error || "Unable to start SharePoint upload.",
    };
  }

  const documentId = created.documentId;
  const storagePath = String(created.blobPath || created.blobName || "");
  if (!created.duplicate) {
    if (!created.uploadUrl) {
      await abortUpload(options.tenderId, documentId);
      return { ok: false, error: "SharePoint upload session was not created." };
    }
    try {
      const upload = await uploadChunks({
        uploadUrl: created.uploadUrl,
        file: options.file,
        signal: options.signal,
      });
      if (!upload.ok) {
        await abortUpload(options.tenderId, documentId);
        return upload;
      }
    } catch (error) {
      await abortUpload(options.tenderId, documentId);
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "SharePoint upload failed. Please try again.",
      };
    }
  }

  const completeRes = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "complete",
      section: options.section,
      feeId: options.feeId || null,
      documentId,
      blobPath: storagePath,
      fileName: options.file.name,
      originalFileName: options.file.name,
      mimeType: options.file.type || "application/octet-stream",
      fileSizeBytes: options.file.size,
    }),
    signal: options.signal,
  });
  const completed = (await completeRes.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    documentId?: string;
    message?: string;
  };
  if (!completeRes.ok || !completed.success) {
    return {
      ok: false,
      error:
        completed.error ||
        "The file reached SharePoint but metadata could not be saved.",
    };
  }

  return {
    ok: true,
    documentId: completed.documentId || documentId,
    message:
      completed.message ||
      (created.duplicate
        ? "Existing SharePoint document linked."
        : "Document uploaded."),
  };
}
