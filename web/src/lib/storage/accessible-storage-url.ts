/**
 * Tender artifact helpers.
 * - List/detail download links: use the SharePoint column URL directly.
 * - AI summary iframe preview: stream via /api/storage/blob → Blob URL
 *   (SharePoint blocks iframe embedding with X-Frame-Options / CSP).
 */

export function isAzureBlobUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".blob.core.windows.net");
  } catch {
    return false;
  }
}

export function isSharePointUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase().endsWith(".sharepoint.com");
  } catch {
    return false;
  }
}

/**
 * Extract the library-relative path from a SharePoint web URL.
 * Example:
 *   .../TenderDocs/companies/.../Tender_All_Documents.zip
 *   → companies/.../Tender_All_Documents.zip
 */
export function sharePointRelativePathFromUrl(
  storageUrl: string | null | undefined,
  libraryName = "TenderDocs",
): string | null {
  if (!storageUrl?.trim() || !isSharePointUrl(storageUrl)) return null;
  try {
    const url = new URL(storageUrl.trim());
    const marker = `/${libraryName}/`;
    const candidates = [
      decodeURIComponent(url.pathname),
      decodeURIComponent(url.searchParams.get("id") || ""),
      decodeURIComponent(url.searchParams.get("RootFolder") || ""),
    ].filter(Boolean);
    for (const candidate of candidates) {
      const index = candidate.toLowerCase().indexOf(marker.toLowerCase());
      if (index < 0) continue;
      const relative = candidate
        .slice(index + marker.length)
        .replace(/\\/g, "/")
        .split("/")
        .filter((segment) => segment && segment !== "." && segment !== "..")
        .join("/");
      if (relative) return relative;
    }
    return null;
  } catch {
    return null;
  }
}

/** Unwrap legacy `/api/storage/blob?url=...` links back to the column URL. */
export function unwrapLegacyProxyUrl(raw: string): string {
  if (!raw.includes("/api/storage/blob")) return raw;
  try {
    const asUrl =
      raw.startsWith("http://") || raw.startsWith("https://")
        ? new URL(raw)
        : new URL(raw, "http://localhost");
    const nested = asUrl.searchParams.get("url")?.trim();
    return nested || raw;
  } catch {
    return raw;
  }
}

/**
 * Return the stored SharePoint column URL for direct open/download links.
 * Azure blob URLs are not used for tender artifacts.
 */
export function toAccessibleStorageUrl(
  storageUrl: string | null | undefined,
  _options?: { download?: boolean; fileName?: string | null },
): string | null {
  if (!storageUrl?.trim()) return null;
  const raw = unwrapLegacyProxyUrl(storageUrl.trim());

  if (isAzureBlobUrl(raw)) return null;
  if (isSharePointUrl(raw)) return raw;

  if (raw.startsWith("/api/")) return null;
  return raw;
}

/**
 * Authenticated same-origin proxy for streaming SharePoint files
 * (Graph content → used to build Blob URLs for iframe preview).
 */
export function toProxiedStorageUrl(
  storageUrl: string | null | undefined,
  options?: { download?: boolean; fileName?: string | null },
): string | null {
  if (!storageUrl?.trim()) return null;
  const raw = unwrapLegacyProxyUrl(storageUrl.trim());

  if (raw.startsWith("/api/storage/blob")) return raw;
  if (!isSharePointUrl(raw)) return null;

  const params = new URLSearchParams();
  params.set("url", raw);
  if (options?.download) params.set("download", "1");
  if (options?.fileName?.trim()) {
    params.set("fileName", options.fileName.trim());
  }
  return `/api/storage/blob?${params.toString()}`;
}
