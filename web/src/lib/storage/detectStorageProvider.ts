/**
 * Central storage-provider detection for document records.
 * Prefer explicit storage_provider; fall back to URL heuristics for legacy rows.
 */
export type StorageProviderKind = "sharepoint" | "azure" | "unknown";

export function detectStorageProvider(document: {
  storage_provider?: string | null;
  storageProvider?: string | null;
  storage_url?: string | null;
  storageUrl?: string | null;
  drive_item_id?: string | null;
  sharepoint_item_id?: string | null;
}): StorageProviderKind {
  const explicit = String(
    document.storage_provider || document.storageProvider || "",
  )
    .trim()
    .toLowerCase();
  if (explicit === "sharepoint") return "sharepoint";
  if (explicit === "azure") return "azure";

  if (document.drive_item_id || document.sharepoint_item_id) {
    return "sharepoint";
  }

  const url = String(document.storage_url || document.storageUrl || "").trim();
  if (!url) return "unknown";
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".sharepoint.com")) return "sharepoint";
    if (host.endsWith(".blob.core.windows.net")) return "azure";
  } catch {
    return "unknown";
  }
  return "unknown";
}
