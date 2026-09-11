/**
 * Safe Azure Blob URL / path parsing.
 * Container name is never treated as part of the blob name.
 */

export type ParsedAzureBlobRef = {
  containerName: string;
  blobName: string;
};

export type AzureBlobResolveCode =
  | "DOCUMENT_URL_MISSING"
  | "AZURE_PATH_RESOLUTION_FAILED"
  | "AZURE_BLOB_NOT_FOUND"
  | "AZURE_AUTH_FAILED"
  | "AZURE_DOWNLOAD_FAILED";

/** Pull an underlying Azure URL out of legacy proxy / nested query forms. */
export function unwrapStoredDocumentReference(value: string): string {
  const raw = value.trim();
  if (!raw) return raw;

  // App proxy: /api/storage/blob?url=<azureUrl>
  if (raw.includes("/api/storage/blob")) {
    try {
      const asUrl = raw.startsWith("http://") || raw.startsWith("https://")
        ? new URL(raw)
        : new URL(raw, "http://localhost");
      const nested = asUrl.searchParams.get("url")?.trim();
      if (nested) return unwrapStoredDocumentReference(nested);
    } catch {
      // fall through
    }
  }

  // Sometimes stored as url=<azure> without a path prefix.
  if (raw.toLowerCase().startsWith("url=")) {
    return unwrapStoredDocumentReference(decodeURIComponent(raw.slice(4)));
  }

  return raw;
}

/**
 * Parse a full Azure blob URL or a relative blob path.
 *
 * Full URL:
 *   https://acct.blob.core.windows.net/companydocuments/companies/siyana/.../file.pdf
 *   → container=companydocuments, blob=companies/siyana/.../file.pdf
 *
 * Relative path (already blob name):
 *   companies/siyana/tender-artifacts/manual/.../file.pdf
 *   → container=defaultContainer, blob=companies/siyana/...
 *
 * Mistakenly prefixed with container:
 *   companydocuments/companies/siyana/...
 *   → container=companydocuments, blob=companies/siyana/...
 */
export function parseAzureBlobUrl(
  value: string,
  options?: { defaultContainer?: string | null },
): ParsedAzureBlobRef {
  const unwrapped = unwrapStoredDocumentReference(value);
  if (!unwrapped) {
    throw new Error("Invalid Azure Blob URL: empty value");
  }

  const defaultContainer = String(options?.defaultContainer || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");

  if (unwrapped.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(unwrapped);
    } catch {
      throw new Error(`Invalid Azure Blob URL: ${value}`);
    }

    const parts = decodeURIComponent(parsed.pathname)
      .split("/")
      .filter(Boolean);

    const containerName = parts.shift();
    if (!containerName || parts.length === 0) {
      throw new Error(`Invalid Azure Blob URL: ${value}`);
    }

    return {
      containerName,
      blobName: parts.join("/"),
    };
  }

  const parts = decodeURIComponent(unwrapped.replace(/^\/+/, ""))
    .split("/")
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error(`Invalid Azure Blob path: ${value}`);
  }

  // Relative path that accidentally includes the container as the first segment.
  if (
    defaultContainer &&
    parts[0]?.toLowerCase() === defaultContainer.toLowerCase() &&
    parts.length > 1
  ) {
    return {
      containerName: defaultContainer,
      blobName: parts.slice(1).join("/"),
    };
  }

  if (!defaultContainer) {
    throw new Error(
      `Relative Azure blob path requires a default container: ${value}`,
    );
  }

  return {
    containerName: defaultContainer,
    blobName: parts.join("/"),
  };
}

export function tryParseAzureBlobUrl(
  value: string | null | undefined,
  options?: { defaultContainer?: string | null },
): ParsedAzureBlobRef | null {
  if (!value?.trim()) return null;
  try {
    return parseAzureBlobUrl(value, options);
  } catch {
    return null;
  }
}

export function azureBlobStorageUrl(
  accountName: string,
  containerName: string,
  blobName: string,
): string {
  const encoded = blobName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://${accountName}.blob.core.windows.net/${containerName}/${encoded}`;
}
