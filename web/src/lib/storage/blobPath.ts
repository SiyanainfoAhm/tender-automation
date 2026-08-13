/**
 * Safe Azure blob path segments for company documents.
 * Never trust raw user names as path components.
 */

export type AzureDocumentCategory = "General" | "Certificate" | "Financial";

export function slugifyBlobSegment(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "item";
}

/** Sanitize a filename while preserving the extension. */
export function sanitizeBlobFileName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[/\\]/g, "");
  const lastDot = trimmed.lastIndexOf(".");
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext = lastDot > 0 ? trimmed.slice(lastDot) : "";
  const safeBase = slugifyBlobSegment(base) || "file";
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${safeBase}${safeExt}`;
}

export function buildCompanyDocumentBlobName(options: {
  companyId: string;
  companyName: string;
  documentId: string;
  documentName: string;
  category: AzureDocumentCategory;
  fileName: string;
}): string {
  const companyId = options.companyId.trim();
  const documentId = options.documentId.trim();
  if (!companyId || companyId.includes("/") || companyId.includes("..")) {
    throw new Error("Invalid company id for blob path");
  }
  if (!documentId || documentId.includes("/") || documentId.includes("..")) {
    throw new Error("Invalid document id for blob path");
  }

  const companyFolder = `${slugifyBlobSegment(options.companyName)}_${companyId}`;
  const documentFolder = `${slugifyBlobSegment(options.documentName)}_${documentId}`;
  const safeFileName = sanitizeBlobFileName(options.fileName);

  return `${companyFolder}/${documentFolder}/${options.category}/${safeFileName}`;
}
