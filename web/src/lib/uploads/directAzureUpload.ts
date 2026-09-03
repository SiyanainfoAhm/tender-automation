import { MAX_DOCUMENT_UPLOAD_BYTES } from "@/lib/uploads/config";
import { validateDocumentFile } from "@/lib/uploads/validation";
import type { TenderDocumentSection } from "@/lib/bid-fees";

export type DirectUploadResult =
  | { ok: true; documentId: string; message?: string }
  | { ok: false; error: string };

type CreateSasResponse = {
  success?: boolean;
  error?: string;
  documentId?: string;
  blobPath?: string;
  blobName?: string;
  uploadUrl?: string;
  storageUrl?: string;
  startsAt?: string;
  expiresAt?: string;
  headers?: Record<string, string>;
};

function headerFrom(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const exact = headers[name];
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function azurePutFailureMessage(status: number, body: string): string {
  const text = body.slice(0, 800);
  if (/AuthenticationFailed|Signature not valid|expired/i.test(text)) {
    return "Azure rejected the upload token (expired or invalid SAS). Retry the upload.";
  }
  if (status === 403 && !text.trim()) {
    return "Azure blocked the upload (often CORS or SAS permissions). Check the red PUT response body.";
  }
  if (status === 403) {
    return "Azure rejected the upload (403). Check the red PUT response for AuthenticationFailed vs CORS.";
  }
  return "Azure upload failed. Please try again.";
}

/**
 * Browser → Azure direct upload (bytes never touch Vercel).
 * 1) Request short-lived write SAS (JSON)
 * 2) PUT file to Azure using headers from /direct-upload
 * 3) Complete with lightweight metadata (JSON)
 */
export async function uploadTenderDocumentDirectToAzure(options: {
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
  if (validation) {
    return { ok: false, error: validation.message };
  }

  const createRes = await fetch(
    `/api/tenders/${encodeURIComponent(options.tenderId)}/documents/direct-upload`,
    {
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
    },
  );
  const created = (await createRes.json().catch(() => ({}))) as CreateSasResponse;
  if (!createRes.ok || !created.success || !created.uploadUrl || !created.documentId) {
    return {
      ok: false,
      error: created.error || "Unable to start direct upload.",
    };
  }

  const documentId = created.documentId;
  const blobPath = String(created.blobPath || created.blobName || "");

  // Only headers returned by /direct-upload (plus required BlockBlob default).
  // Do not add x-ms-version here — extra headers can fail Azure CORS preflight.
  const putHeaders = new Headers();
  putHeaders.set(
    "x-ms-blob-type",
    headerFrom(created.headers, "x-ms-blob-type") || "BlockBlob",
  );
  putHeaders.set(
    "Content-Type",
    headerFrom(created.headers, "Content-Type") ||
      options.file.type ||
      "application/octet-stream",
  );

  let azureOk = false;
  try {
    const put = await fetch(created.uploadUrl, {
      method: "PUT",
      headers: putHeaders,
      body: options.file,
      signal: options.signal,
    });
    azureOk = put.ok;
    if (!put.ok) {
      const detail = await put.text().catch(() => "");
      console.error("[direct-upload] Azure PUT failed", {
        status: put.status,
        documentId,
        blobPath,
        expiresAt: created.expiresAt ?? null,
        startsAt: created.startsAt ?? null,
        detail: detail.slice(0, 500),
      });
      await fetch(
        `/api/tenders/${encodeURIComponent(options.tenderId)}/documents/direct-upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "abort", documentId }),
        },
      ).catch(() => null);
      return {
        ok: false,
        error: azurePutFailureMessage(put.status, detail),
      };
    }
  } catch (error) {
    await fetch(
      `/api/tenders/${encodeURIComponent(options.tenderId)}/documents/direct-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "abort", documentId }),
      },
    ).catch(() => null);
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Azure upload failed. Please try again.",
    };
  }

  if (!azureOk) {
    return { ok: false, error: "Azure upload failed. Please try again." };
  }

  const completeRes = await fetch(
    `/api/tenders/${encodeURIComponent(options.tenderId)}/documents/direct-upload`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "complete",
        section: options.section,
        feeId: options.feeId || null,
        documentId,
        blobPath,
        fileName: options.file.name,
        originalFileName: options.file.name,
        mimeType: options.file.type || "application/octet-stream",
        fileSizeBytes: options.file.size,
      }),
      signal: options.signal,
    },
  );
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
        "The file reached Azure but metadata could not be saved.",
    };
  }

  return {
    ok: true,
    documentId: completed.documentId || documentId,
    message: completed.message || "Document uploaded.",
  };
}
