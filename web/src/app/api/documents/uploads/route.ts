import { NextResponse } from "next/server";

import type { AzureDocumentCategory } from "@/lib/storage/blobPath";
import { StorageNotConfiguredError } from "@/lib/storage/documentStorageProvider";
import {
  StorageFunctionError,
  getDocumentStorageProvider,
} from "@/server/storage/edgeDocumentStorageProvider";
import {
  jsonError,
  requireDocumentUploader,
} from "@/server/uploads/requireDocumentUploader";

function resolveCategory(raw: unknown): AzureDocumentCategory {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "certificate") return "Certificate";
  if (value === "financial") return "Financial";
  if (raw === "Certificate" || raw === "Financial") {
    return raw;
  }
  return "General";
}

export async function POST(request: Request) {
  try {
    const auth = await requireDocumentUploader();
    if (auth.error) return auth.error;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return jsonError("Invalid upload session request.", 400);
    }

    const provider = getDocumentStorageProvider();
    const session = await provider.createUploadSession({
      documentName: String(body.name || body.documentName || ""),
      fileName: String(body.fileName || ""),
      mimeType: String(body.mimeType || "application/octet-stream"),
      fileSizeBytes: Number(body.fileSizeBytes),
      category: resolveCategory(body.uploadKind || body.category),
      notes: body.notes == null ? null : String(body.notes),
      certificateType:
        body.certificateType == null ? null : String(body.certificateType),
      issuingAuthority:
        body.issuingAuthority == null ? null : String(body.issuingAuthority),
      issueDate: body.issueDate == null ? null : String(body.issueDate),
      expiryDate: body.expiryDate == null ? null : String(body.expiryDate),
      financialYear:
        body.financialYear == null ? null : String(body.financialYear),
      documentType: body.documentType == null ? null : String(body.documentType),
    });

    return NextResponse.json({ success: true, ...session });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return jsonError("Storage unavailable", 503);
    }
    if (error instanceof StorageFunctionError) {
      return jsonError(error.message, error.status || 500);
    }
    console.error("[documents] create upload session failed", error);
    return jsonError(
      error instanceof Error ? error.message : "Unable to start upload.",
      500,
    );
  }
}
