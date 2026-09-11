import {
  buildTenderArtifactBlobName,
  sanitizeBlobFileName,
  slugifyBlobSegment,
} from "@/lib/storage/blobPath";

export function resolveCompanyBlobKey(options?: {
  companyKey?: string | null;
  companyName?: string | null;
}): string {
  const envKey = String(
    options?.companyKey ||
      process.env.COMPANY_BLOB_KEY ||
      process.env.NEXT_PUBLIC_COMPANY_BLOB_KEY ||
      "",
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (envKey) return envKey;
  return (
    slugifyBlobSegment(options?.companyName || "siyana").split("-")[0] ||
    "siyana"
  );
}

export function normalizeArtifactPortal(
  sourcePortal: string | null | undefined,
): string {
  const portal = String(sourcePortal || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  return portal || "unknown";
}

export function artifactRunDate(
  createdAt: string | null | undefined,
  fallback = new Date().toISOString().slice(0, 10),
): string {
  const raw = String(createdAt || "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : fallback;
}

/** Folder prefix ending with `/` for listing blobs under a tender artifact folder. */
export function buildTenderArtifactPrefix(options: {
  companyName: string;
  companyId: string;
  sourcePortal: string;
  sourceTenderId: string;
  runDate: string;
  companyKey?: string | null;
}): string {
  const full = buildTenderArtifactBlobName({
    ...options,
    fileName: "__placeholder__.bin",
  });
  return full.slice(0, full.lastIndexOf("/") + 1);
}

/**
 * Candidate blob names when reconstructing without a persisted URL.
 * Manual uploads use `{docId8}_{originalName}` which sanitizes to `{docId8}-{safeName}`.
 */
export function buildTenderArtifactCandidateBlobNames(options: {
  companyName: string;
  companyId: string;
  sourcePortal: string;
  sourceTenderId: string;
  runDate: string;
  fileName: string;
  documentId?: string | null;
  companyDocumentId?: string | null;
  companyKey?: string | null;
}): string[] {
  const safe = sanitizeBlobFileName(options.fileName);
  const prefix = buildTenderArtifactPrefix(options);
  const candidates = new Set<string>();

  candidates.add(`${prefix}${safe}`);
  candidates.add(
    buildTenderArtifactBlobName({
      ...options,
      fileName: options.fileName,
    }),
  );

  for (const id of [options.companyDocumentId, options.documentId]) {
    const short = String(id || "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 8);
    if (!short) continue;
    // Edge upload naming: `${documentId.slice(0, 8)}_${file.name}` → sanitized with `-`
    candidates.add(`${prefix}${short}-${safe}`);
    candidates.add(`${prefix}${safe.replace(/(\.[^.]+)?$/, `-${short}$1`)}`);
  }

  return [...candidates];
}

function fileStem(name: string): string {
  const base = name.split("/").pop() || name;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

/**
 * Pick the best blob under a listed prefix using persisted filename metadata.
 * Prefers exact sanitized filename, then suffix match `*-{safeName}`, then stem contains.
 */
export function pickBlobNameFromPrefixList(options: {
  blobNames: string[];
  fileNameHint?: string | null;
  preferredBlobName?: string | null;
}): string | null {
  const names = options.blobNames
    .map((n) => n.trim())
    .filter((n) => n && !n.endsWith("/"));
  if (names.length === 0) return null;

  const preferred = String(options.preferredBlobName || "").trim();
  if (preferred && names.includes(preferred)) return preferred;

  const hint = String(options.fileNameHint || "").trim();
  if (!hint) {
    return names.length === 1 ? names[0] : null;
  }

  const safeHint = sanitizeBlobFileName(hint);
  const exact = names.find((n) => n.split("/").pop() === safeHint);
  if (exact) return exact;

  const suffix = names.filter((n) => {
    const leaf = n.split("/").pop() || "";
    return leaf === safeHint || leaf.endsWith(`-${safeHint}`);
  });
  if (suffix.length === 1) return suffix[0];
  if (suffix.length > 1) {
    return suffix.sort(
      (a, b) =>
        (b.split("/").pop() || "").length - (a.split("/").pop() || "").length,
    )[0];
  }

  const stem = fileStem(safeHint);
  const stemHits = names.filter((n) => {
    const leaf = (n.split("/").pop() || "").toLowerCase();
    return leaf.includes(stem);
  });
  if (stemHits.length === 1) return stemHits[0];
  if (stemHits.length > 1) {
    return stemHits.sort(
      (a, b) =>
        (b.split("/").pop() || "").length - (a.split("/").pop() || "").length,
    )[0];
  }

  return names.length === 1 ? names[0] : null;
}
