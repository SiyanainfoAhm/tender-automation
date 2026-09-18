/**
 * Resolve tender artifact URLs from document_urls JSON + scalar columns.
 * SharePoint entries in document_urls are preferred for app downloads.
 */

export type TenderDocumentUrlEntry = {
  url: string;
  type?: string | null;
  document_type?: string | null;
  updated_at?: string | null;
};

export type ResolvedTenderArtifactUrls = {
  documentsZipUrl: string | null;
  aiSummaryUrl: string | null;
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function isSharePointHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith(".sharepoint.com");
  } catch {
    return url.toLowerCase().includes(".sharepoint.com");
  }
}

/** Parse document_urls jsonb (array of { url, type, document_type, updated_at }). */
export function parseTenderDocumentUrls(
  value: unknown,
): TenderDocumentUrlEntry[] {
  if (!Array.isArray(value)) return [];
  const out: TenderDocumentUrlEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = asTrimmedString(record.url);
    if (!url) continue;
    out.push({
      url,
      type: asTrimmedString(record.type),
      document_type: asTrimmedString(record.document_type),
      updated_at: asTrimmedString(record.updated_at),
    });
  }
  return out;
}

function pickByDocumentType(
  entries: TenderDocumentUrlEntry[],
  documentType: string,
): string | null {
  const matches = entries.filter(
    (entry) =>
      String(entry.document_type || "").toLowerCase() === documentType,
  );
  if (matches.length === 0) return null;
  // Prefer an explicit SharePoint entry when both exist.
  const sharePoint = matches.find(
    (entry) =>
      String(entry.type || "").toLowerCase() === "sharepoint" ||
      isSharePointHost(entry.url),
  );
  return (sharePoint || matches[0])?.url ?? null;
}

/**
 * Canonical artifact URLs for the app.
 * Prefer document_urls entries; fall back to documents_zip_url / ai_summary_url.
 * Only SharePoint URLs count as present (Azure leftovers are ignored).
 */
export function resolveTenderArtifactUrls(tender: {
  document_urls?: unknown;
  documents_zip_url?: unknown;
  ai_summary_url?: unknown;
}): ResolvedTenderArtifactUrls {
  const entries = parseTenderDocumentUrls(tender.document_urls);
  const fromJsonZip = pickByDocumentType(entries, "documents_zip");
  const fromJsonSummary = pickByDocumentType(entries, "ai_summary");
  const scalarZip = asTrimmedString(tender.documents_zip_url);
  const scalarSummary = asTrimmedString(tender.ai_summary_url);

  const documentsZipUrl =
    (fromJsonZip && isSharePointHost(fromJsonZip) ? fromJsonZip : null) ||
    (scalarZip && isSharePointHost(scalarZip) ? scalarZip : null) ||
    null;

  const aiSummaryUrl =
    (fromJsonSummary && isSharePointHost(fromJsonSummary)
      ? fromJsonSummary
      : null) ||
    (scalarSummary && isSharePointHost(scalarSummary) ? scalarSummary : null) ||
    null;

  return { documentsZipUrl, aiSummaryUrl };
}
