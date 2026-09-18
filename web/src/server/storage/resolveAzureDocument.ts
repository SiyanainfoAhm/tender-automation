import "server-only";

import { isSharePointUrl } from "@/lib/storage/accessible-storage-url";
import {
  tryParseAzureBlobUrl,
  type AzureBlobResolveCode,
} from "@/lib/storage/parseAzureBlobUrl";
import {
  artifactRunDate,
  buildTenderArtifactCandidateBlobNames,
  buildTenderArtifactPrefix,
  normalizeArtifactPortal,
} from "@/lib/storage/resolveTenderArtifactPath";
import {
  invokeBlobRead,
  invokeBlobResolve,
} from "@/server/storage/tenderAutomationDocumentFunctions";

export type ResolvedAzureDocument = {
  storageUrl: string;
  blobName: string;
  containerName: string | null;
  source: "persisted_url" | "candidate" | "prefix_list";
};

export type ResolveAzureDocumentFailure = {
  ok: false;
  code: AzureBlobResolveCode;
  error: string;
};

export type ResolveAzureDocumentSuccess = {
  ok: true;
  resolved: ResolvedAzureDocument;
};

export async function resolveAzureDocumentReference(options: {
  tenderId: string;
  sourcePortal?: string | null;
  sourceTenderId?: string | null;
  createdAt?: string | null;
  companyId: string;
  companyName?: string | null;
  storedDocumentUrl?: string | null;
  fileName?: string | null;
  documentId?: string | null;
  companyDocumentId?: string | null;
}): Promise<ResolveAzureDocumentSuccess | ResolveAzureDocumentFailure> {
  const storedDocumentUrl = String(options.storedDocumentUrl || "").trim();

  // SharePoint artifact URLs — never resolve via Azure.
  if (isSharePointUrl(storedDocumentUrl)) {
    return {
      ok: true,
      resolved: {
        storageUrl: storedDocumentUrl,
        blobName: "",
        containerName: null,
        source: "persisted_url",
      },
    };
  }

  const defaultContainer =
    process.env.TENDER_AUTOMATION_AZURE_STORAGE_CONTAINER_NAME?.trim() ||
    "companydocuments";
  const portal = normalizeArtifactPortal(options.sourcePortal);
  const sourceTenderId = String(
    options.sourceTenderId || options.tenderId || "",
  ).trim();
  const runDate = artifactRunDate(options.createdAt);
  const fileName = String(options.fileName || "").trim();

  const companyName =
    String(options.companyName || "").trim() ||
    process.env.COMPANY_NAME?.trim() ||
    "Siyana Info Solutions Pvt. Ltd.";

  const prefix =
    sourceTenderId && (portal === "manual" || portal === "tender247" || portal === "bidassist")
      ? buildTenderArtifactPrefix({
          companyName,
          companyId: options.companyId,
          sourcePortal: portal,
          sourceTenderId,
          runDate,
        })
      : "";

  const candidates =
    sourceTenderId && fileName
      ? buildTenderArtifactCandidateBlobNames({
          companyName,
          companyId: options.companyId,
          sourcePortal: portal || "manual",
          sourceTenderId,
          runDate,
          fileName,
          documentId: options.documentId,
          companyDocumentId: options.companyDocumentId,
        })
      : [];

  const parsed = tryParseAzureBlobUrl(storedDocumentUrl, {
    defaultContainer,
  });

  console.log("[Azure Document Resolve]", {
    tenderId: options.tenderId,
    sourcePortal: options.sourcePortal || null,
    storedDocumentUrl: storedDocumentUrl || null,
    containerName: parsed?.containerName || defaultContainer,
    blobName: parsed?.blobName || null,
    prefix: prefix || null,
  });

  const resolved = await invokeBlobResolve({
    storageUrl: storedDocumentUrl || undefined,
    blobName: parsed?.blobName,
    prefix: prefix || undefined,
    fileName: fileName || undefined,
    tenderId: options.tenderId,
    sourcePortal: options.sourcePortal || undefined,
    candidateBlobNames: candidates,
  });

  if (resolved.success && resolved.blobName && resolved.storageUrl) {
    const source: ResolvedAzureDocument["source"] = storedDocumentUrl
      ? "persisted_url"
      : candidates.includes(resolved.blobName)
        ? "candidate"
        : "prefix_list";
    return {
      ok: true,
      resolved: {
        storageUrl: resolved.storageUrl,
        blobName: resolved.blobName,
        containerName: resolved.containerName || defaultContainer,
        source,
      },
    };
  }

  const code = (resolved.code ||
    (storedDocumentUrl
      ? "AZURE_PATH_RESOLUTION_FAILED"
      : "DOCUMENT_URL_MISSING")) as AzureBlobResolveCode;

  return {
    ok: false,
    code:
      resolved.status === 404
        ? "AZURE_BLOB_NOT_FOUND"
        : code === "DOCUMENT_URL_MISSING" && !storedDocumentUrl
          ? "DOCUMENT_URL_MISSING"
          : code,
    error:
      resolved.error ||
      (code === "DOCUMENT_URL_MISSING"
        ? "No document URL or blob path is available for this file."
        : "The stored document path could not be resolved in Azure."),
  };
}

export async function readResolvedAzureDocument(options: {
  resolved: ResolvedAzureDocument;
  disposition: "inline" | "attachment";
  fileName?: string | null;
  tenderId?: string | null;
  sourcePortal?: string | null;
  prefix?: string | null;
}): Promise<Response> {
  return invokeBlobRead({
    storageUrl: options.resolved.storageUrl,
    blobName: options.resolved.blobName || undefined,
    disposition: options.disposition,
    fileName: options.fileName,
    tenderId: options.tenderId,
    sourcePortal: options.sourcePortal,
    prefix: options.prefix,
  });
}
