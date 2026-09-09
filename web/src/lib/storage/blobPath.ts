/**
 * Safe Azure blob path segments for company documents and tender artifacts.
 * Never trust raw user names as path components.
 *
 * Layout:
 *   {companyName}_{companyId}/
 *     companydocs/
 *       General|Certificate|Other/
 *         {documentName}_{documentId}/{file}
 *     tender-artifacts/
 *       {portal}/{date}/{tenderId}/{file}
 *     templates/
 *       …
 */

export type AzureDocumentCategory = "General" | "Certificate" | "Financial";

export type AzureCompanyDocsFolder = "General" | "Certificate" | "Other";

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

export function buildCompanyRootFolder(
  companyName: string,
  companyId: string,
): string {
  const id = companyId.trim();
  if (!id || id.includes("/") || id.includes("..")) {
    throw new Error("Invalid company id for blob path");
  }
  return `${slugifyBlobSegment(companyName)}_${id}`;
}

/**
 * Map DB/UI document categories onto the three Azure companydocs folders.
 * Financial (and any other non-certificate types) land under Other.
 */
export function azureCompanyDocsFolder(
  category: AzureDocumentCategory | string,
): AzureCompanyDocsFolder {
  const value = String(category || "").trim();
  if (value === "Certificate") return "Certificate";
  if (value === "General") return "General";
  return "Other";
}

export function buildCompanyDocumentBlobName(options: {
  companyId: string;
  companyName: string;
  documentId: string;
  documentName: string;
  category: AzureDocumentCategory | string;
  fileName: string;
}): string {
  const documentId = options.documentId.trim();
  if (!documentId || documentId.includes("/") || documentId.includes("..")) {
    throw new Error("Invalid document id for blob path");
  }

  const companyRoot = buildCompanyRootFolder(
    options.companyName,
    options.companyId,
  );
  const categoryFolder = azureCompanyDocsFolder(options.category);
  const documentFolder = `${slugifyBlobSegment(options.documentName)}_${documentId}`;
  const safeFileName = sanitizeBlobFileName(options.fileName);

  return `${companyRoot}/companydocs/${categoryFolder}/${documentFolder}/${safeFileName}`;
}

export function buildTenderArtifactBlobName(options: {
  companyName: string;
  companyId: string;
  sourcePortal: string;
  sourceTenderId: string;
  runDate: string;
  fileName: string;
}): string {
  const companyRoot = buildCompanyRootFolder(
    options.companyName,
    options.companyId,
  );
  const portal = String(options.sourcePortal || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  const id = String(options.sourceTenderId)
    .replace(/^T247-/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(options.runDate)
    ? options.runDate
    : "undated";
  return `${companyRoot}/tender-artifacts/${portal || "unknown"}/${date}/${id || "unknown"}/${sanitizeBlobFileName(options.fileName)}`;
}
