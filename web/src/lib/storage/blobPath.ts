/**
 * Safe Azure blob path segments for company documents and tender artifacts.
 * Never trust raw user names as path components.
 *
 * Layout:
 *   {companyName}_{companyId}/
 *     companydocs/
 *       General|Certificate|Other/{file}
 *     tender-artifacts/
 *       {portal}/{date}/{tenderId}/{file}
 *   companies/{key}/tender-artifacts/manual/{date}/{tenderId}/{file}
 *     (manual tenders — legacy Storage Explorer layout)
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

/**
 * Prefer unique blob names when two uploads share a filename.
 * `{safeFile}-{shortDocId}.ext` when documentId is present.
 */
export function companyDocumentFileName(options: {
  fileName: string;
  documentId?: string | null;
}): string {
  const safeFileName = sanitizeBlobFileName(options.fileName);
  const documentId = String(options.documentId || "").trim();
  if (!documentId || documentId.includes("/") || documentId.includes("..")) {
    return safeFileName;
  }
  const lastDot = safeFileName.lastIndexOf(".");
  const base = lastDot > 0 ? safeFileName.slice(0, lastDot) : safeFileName;
  const ext = lastDot > 0 ? safeFileName.slice(lastDot) : "";
  const shortId = documentId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "doc";
  return `${base}-${shortId}${ext}`;
}

export function buildCompanyDocumentBlobName(options: {
  companyId: string;
  companyName: string;
  documentId: string;
  documentName: string;
  category: AzureDocumentCategory | string;
  fileName: string;
}): string {
  void options.documentName;
  const companyRoot = buildCompanyRootFolder(
    options.companyName,
    options.companyId,
  );
  const categoryFolder = azureCompanyDocsFolder(options.category);
  const safeFileName = companyDocumentFileName({
    fileName: options.fileName,
    documentId: options.documentId,
  });

  return `${companyRoot}/companydocs/${categoryFolder}/${safeFileName}`;
}

/**
 * Tender artifact blob paths.
 * - MANUAL → companies/{key}/tender-artifacts/manual/{date}/{id}/{file}
 *   (matches existing Azure Storage Explorer layout)
 * - Portal crawlers → {companyName}_{companyId}/tender-artifacts/{portal}/…
 */
export function buildTenderArtifactBlobName(options: {
  companyName: string;
  companyId: string;
  sourcePortal: string;
  sourceTenderId: string;
  runDate: string;
  fileName: string;
  companyKey?: string | null;
}): string {
  const portal = String(options.sourcePortal || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  const id = String(options.sourceTenderId)
    .replace(/^T247-/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(options.runDate)
    ? options.runDate
    : "undated";
  const file = sanitizeBlobFileName(options.fileName);

  if (portal === "manual") {
    const envKey = String(
      options.companyKey ||
        process.env.COMPANY_BLOB_KEY ||
        process.env.NEXT_PUBLIC_COMPANY_BLOB_KEY ||
        "",
    )
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const key =
      envKey || slugifyBlobSegment(options.companyName).split("-")[0] || "company";
    return `companies/${key}/tender-artifacts/manual/${date}/${id || "unknown"}/${file}`;
  }

  const companyRoot = buildCompanyRootFolder(
    options.companyName,
    options.companyId,
  );
  return `${companyRoot}/tender-artifacts/${portal || "unknown"}/${date}/${id || "unknown"}/${file}`;
}
