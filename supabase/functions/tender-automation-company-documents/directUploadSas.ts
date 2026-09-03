/**
 * Short-lived write-only Azure Blob SAS helpers for browser direct upload.
 * Requires Edge secret: TENDER_AUTOMATION_AZURE_STORAGE_ACCOUNT_KEY
 */
import {
  BlobSASPermissions,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "npm:@azure/storage-blob@12.26.0";

const DIRECT_UPLOAD_SAS_TTL_MS = 15 * 60 * 1000;

export type AzureSasConfig = {
  accountName: string;
  containerName: string;
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

export function createWriteOnlyBlobUploadUrl(options: {
  azure: AzureSasConfig;
  blobName: string;
  contentType?: string | null;
  ttlMs?: number;
}): { uploadUrl: string; storageUrl: string; expiresAt: string } {
  const accountKey = requireAzureAccountKey();
  const credential = new StorageSharedKeyCredential(
    options.azure.accountName,
    accountKey,
  );
  const ttl = options.ttlMs ?? DIRECT_UPLOAD_SAS_TTL_MS;
  const startsOn = new Date(Date.now() - 60_000);
  const expiresOn = new Date(Date.now() + ttl);

  // Create + Write only — no read/list/delete on this token.
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

  return {
    uploadUrl: `${storageUrl}?${sas}`,
    storageUrl,
    expiresAt: expiresOn.toISOString(),
  };
}

export { DIRECT_UPLOAD_SAS_TTL_MS };
