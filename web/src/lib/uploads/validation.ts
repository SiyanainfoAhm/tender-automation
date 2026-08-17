import { ALLOWED_DOCUMENT_EXTENSIONS } from "@/lib/company/types";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_DOCUMENT_UPLOAD_SIZE_MB,
} from "@/lib/uploads/config";
import { UploadError } from "@/lib/uploads/errors";
import { formatSizeLimitMb } from "@/lib/uploads/progress";
import type { DocumentUploadMetadata, UploadKind } from "@/lib/uploads/types";

const GENERIC_MIME = new Set(["", "application/octet-stream"]);

export function documentFileExtension(fileName: string): string | null {
  const trimmed = fileName.trim().toLowerCase();
  const match = ALLOWED_DOCUMENT_EXTENSIONS.find((ext) => trimmed.endsWith(ext));
  return match ?? null;
}

export function isAllowedDocumentMimeType(mimeType: string | null | undefined): boolean {
  const mime = (mimeType || "").trim().toLowerCase();
  if (GENERIC_MIME.has(mime)) return true;
  return (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mime);
}

export function documentUploadAcceptAttr(): string {
  return [...ALLOWED_DOCUMENT_EXTENSIONS].join(",");
}

export function documentUploadHint(maxBytes = MAX_DOCUMENT_UPLOAD_BYTES): string {
  const types = "PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, ZIP";
  return `${types} up to ${formatSizeLimitMb(maxBytes)}`;
}

export function validateDocumentFile(
  file: File | null | undefined,
  maxBytes = MAX_DOCUMENT_UPLOAD_BYTES,
): UploadError | null {
  if (!file) {
    return new UploadError("empty_file", "Please select a file to upload");
  }
  const name = file.name?.trim() || "";
  if (!name) {
    return new UploadError("validation", "File name is required");
  }
  if (file.size <= 0) {
    return new UploadError("empty_file", "File is empty");
  }
  if (file.size > maxBytes) {
    return new UploadError(
      "file_too_large",
      `File too large. Maximum size is ${formatSizeLimitMb(maxBytes)}.`,
    );
  }
  if (!documentFileExtension(name)) {
    return new UploadError(
      "unsupported_type",
      "Unsupported type. Use PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, or ZIP.",
    );
  }
  if (!isAllowedDocumentMimeType(file.type)) {
    return new UploadError("unsupported_type", "Unsupported type");
  }
  return null;
}

export function validateDocumentMetadata(
  metadata: DocumentUploadMetadata,
): UploadError | null {
  const name = metadata.name.trim();
  if (!name) {
    return new UploadError("validation", "Document name is required");
  }
  if (name.length > 200) {
    return new UploadError("validation", "Document name is too long");
  }
  const kind: UploadKind = metadata.uploadKind;
  if (kind === "certificate") {
    if (!metadata.certificateType?.trim()) {
      return new UploadError("validation", "Certificate type is required");
    }
    if (!metadata.issuingAuthority?.trim()) {
      return new UploadError("validation", "Issuing authority is required");
    }
    if (!metadata.issueDate?.trim()) {
      return new UploadError("validation", "Issue date is required");
    }
    if (!metadata.expiryDate?.trim()) {
      return new UploadError("validation", "Expiry date is required");
    }
    if (metadata.expiryDate < metadata.issueDate) {
      return new UploadError(
        "validation",
        "Expiry date must be on or after issue date",
      );
    }
  }
  if (kind === "financial") {
    if (!metadata.financialYear?.trim()) {
      return new UploadError("validation", "Financial year is required");
    }
    if (!metadata.documentType?.trim()) {
      return new UploadError("validation", "Document type is required");
    }
  }
  return null;
}

export { MAX_DOCUMENT_UPLOAD_SIZE_MB };
