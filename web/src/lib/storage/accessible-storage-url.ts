/**
 * Convert stored Azure blob URLs into app proxy URLs.
 * Azure storage accounts with public access disabled cannot be opened directly.
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

export function toAccessibleStorageUrl(
  storageUrl: string | null | undefined,
  options?: { download?: boolean; fileName?: string | null },
): string | null {
  if (!storageUrl?.trim()) return null;
  const raw = storageUrl.trim();

  // Already an app proxy / relative API path.
  if (raw.startsWith("/api/")) return raw;

  if (!isAzureBlobUrl(raw)) return raw;

  const params = new URLSearchParams();
  params.set("url", raw);
  if (options?.download) params.set("download", "1");
  if (options?.fileName?.trim()) {
    params.set("fileName", options.fileName.trim());
  }
  return `/api/storage/blob?${params.toString()}`;
}
