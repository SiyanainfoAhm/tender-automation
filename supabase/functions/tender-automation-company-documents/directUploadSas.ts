/**
 * Short-lived write-only Azure Blob SAS helpers for browser direct upload.
 * Requires Edge secret: TENDER_AUTOMATION_AZURE_STORAGE_ACCOUNT_KEY
 *
 * Times are always UTC via Date/ISO — never IST/local conversion.
 */
import {
  BlobSASPermissions,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "npm:@azure/storage-blob@12.26.0";

/** Allow client/Azure clock skew. */
export const DIRECT_UPLOAD_SAS_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Long enough for large ZIP/PDF PUTs. */
export const DIRECT_UPLOAD_SAS_TTL_MS = 30 * 60 * 1000;

export type AzureSasConfig = {
  accountName: string;
  containerName: string;
};

export type DirectUploadSasResult = {
  uploadUrl: string;
  storageUrl: string;
  startsAt: string;
  expiresAt: string;
  validityDurationMs: number;
  sasSt: string | null;
  sasSe: string | null;
  sasSp: string | null;
};

export function requireAzureAccountKey(): string {
  const key = Deno.env.get("TENDER_AUTOMATION_AZURE_STORAGE_ACCOUNT_KEY")?.trim();
  if (!key) {
    throw new Error(
      "Direct browser uploads require TENDER_AUTOMATION_AZURE_STORAGE_ACCOUNT_KEY (Edge Function secret).",
    );
  }
  return key;
}

export function computeDirectUploadSasWindow(nowMs = Date.now()): {
  startsOn: Date;
  expiresOn: Date;
  validityDurationMs: number;
} {
  const startsOn = new Date(nowMs - DIRECT_UPLOAD_SAS_CLOCK_SKEW_MS);
  const expiresOn = new Date(nowMs + DIRECT_UPLOAD_SAS_TTL_MS);
  return {
    startsOn,
    expiresOn,
    validityDurationMs: expiresOn.getTime() - startsOn.getTime(),
  };
}

function sasQueryParams(sas: string): URLSearchParams {
  const query = sas.startsWith("?") ? sas.slice(1) : sas;
  const qIndex = query.indexOf("?");
  const raw = qIndex >= 0 ? query.slice(qIndex + 1) : query;
  return new URLSearchParams(raw.includes("=") ? raw : sas);
}

export function createWriteOnlyBlobUploadUrl(options: {
  azure: AzureSasConfig;
  blobName: string;
  contentType?: string | null;
  nowMs?: number;
}): DirectUploadSasResult {
  const accountKey = requireAzureAccountKey();
  const credential = new StorageSharedKeyCredential(
    options.azure.accountName,
    accountKey,
  );
  const { startsOn, expiresOn, validityDurationMs } =
    computeDirectUploadSasWindow(options.nowMs ?? Date.now());

  // Create + Write — required for Put Block Blob. No read/list/delete.
  const sas = generateBlobSASQueryParameters(
    {
      containerName: options.azure.containerName,
      blobName: options.blobName,
      permissions: BlobSASPermissions.parse("cw"),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    credential,
  ).toString();

  const encoded = options.blobName
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const storageUrl =
    `https://${options.azure.accountName}.blob.core.windows.net/` +
    `${options.azure.containerName}/${encoded}`;
  const params = sasQueryParams(sas);

  return {
    uploadUrl: `${storageUrl}?${sas}`,
    storageUrl,
    startsAt: startsOn.toISOString(),
    expiresAt: expiresOn.toISOString(),
    validityDurationMs,
    sasSt: params.get("st"),
    sasSe: params.get("se"),
    sasSp: params.get("sp"),
  };
}
