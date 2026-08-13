/**
 * Document storage provider boundary.
 * Physical files: Azure Blob. Metadata: Supabase.
 */

import {
  buildCompanyDocumentBlobName,
  type AzureDocumentCategory,
} from "@/lib/storage/blobPath";

export type StoredDocumentRef = {
  storageProvider: "none" | "azure" | "local";
  storageContainer: string | null;
  storageBlobName: string | null;
  storageUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  originalFileName: string | null;
};

export type DocumentUploadInput = {
  companyId: string;
  companyName: string;
  documentId: string;
  documentName: string;
  category: AzureDocumentCategory;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
};

export interface DocumentStorageProvider {
  readonly name: string;
  isConfigured(): boolean;
  upload(input: DocumentUploadInput): Promise<StoredDocumentRef>;
  delete(ref: StoredDocumentRef): Promise<void>;
  getDownloadUrl(ref: StoredDocumentRef): Promise<string>;
}

export class StorageNotConfiguredError extends Error {
  readonly code = "STORAGE_NOT_CONFIGURED";
  constructor(message = "Document storage is not configured yet.") {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}

/**
 * Default provider until Azure credentials are configured.
 * Rejects uploads explicitly — never fabricates success.
 */
export class UnconfiguredDocumentStorageProvider
  implements DocumentStorageProvider
{
  readonly name = "none";

  isConfigured(): boolean {
    return false;
  }

  async upload(_input: DocumentUploadInput): Promise<StoredDocumentRef> {
    void _input;
    throw new StorageNotConfiguredError(
      "Document storage runs via Supabase Edge Functions. Configure TENDER_AUTOMATION_AZURE_STORAGE_ACCOUNT_NAME, TENDER_AUTOMATION_AZURE_STORAGE_CONTAINER_NAME, and TENDER_AUTOMATION_AZURE_STORAGE_SAS_TOKEN as Edge Function secrets.",
    );
  }

  async delete(_ref: StoredDocumentRef): Promise<void> {
    void _ref;
    throw new StorageNotConfiguredError();
  }

  async getDownloadUrl(_ref: StoredDocumentRef): Promise<string> {
    void _ref;
    throw new StorageNotConfiguredError();
  }
}

/** @deprecated Prefer buildCompanyDocumentBlobName from blobPath.ts */
export function buildCompanyBlobPath(options: {
  companyId: string;
  companyName: string;
  documentId: string;
  documentName: string;
  category: AzureDocumentCategory;
  fileName: string;
}): string {
  return buildCompanyDocumentBlobName(options);
}
