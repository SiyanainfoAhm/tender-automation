import "server-only";

import {
  StorageNotConfiguredError,
  type CreateUploadSessionInput,
  type DocumentStorageProvider,
  type DocumentUploadInput,
  type StoredDocumentRef,
  type UploadChunkAck,
  type UploadChunkInput,
  type UploadSessionRef,
} from "@/lib/storage/documentStorageProvider";
import {
  invokeAbortUpload,
  invokeCompleteUpload,
  invokeCreateUploadSession,
  invokeDocumentUpload,
  invokeUploadChunk,
} from "@/server/storage/tenderAutomationDocumentFunctions";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Azure Block Blob writes go through the Edge Function so account keys
 * never reach Next.js or the browser.
 */
export class EdgeFunctionDocumentStorageProvider
  implements DocumentStorageProvider
{
  readonly name = "azure";

  isConfigured(): boolean {
    return Boolean(
      process.env.SUPABASE_URL?.trim() &&
        (process.env.SUPABASE_SECRET_KEY?.trim() ||
          process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    );
  }

  async upload(input: DocumentUploadInput): Promise<StoredDocumentRef> {
    const formData = new FormData();
    formData.set("action", "upload");
    formData.set("documentName", input.documentName);
    formData.set("name", input.documentName);
    formData.set("category", input.category);
    formData.set(
      "file",
      new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
      input.fileName,
    );
    const result = await invokeDocumentUpload(formData);
    if (!result.success) {
      throw new Error(result.error || "Unable to upload document.");
    }
    return {
      storageProvider: "azure",
      storageContainer: null,
      storageBlobName: null,
      storageUrl: null,
      mimeType: input.mimeType,
      fileSizeBytes: input.bytes.byteLength,
      originalFileName: input.fileName,
    };
  }

  async createUploadSession(
    input: CreateUploadSessionInput,
  ): Promise<UploadSessionRef> {
    const result = await invokeCreateUploadSession(input);
    if (!result.success) {
      throw new StorageFunctionError(
        result.error || "Unable to start upload session.",
        result.status,
      );
    }
    return {
      uploadId: asString(result.uploadId),
      documentId: asString(result.documentId),
      chunkSize: asNumber(result.chunkSize),
      totalChunks: asNumber(result.totalChunks),
    };
  }

  async uploadChunk(input: UploadChunkInput): Promise<UploadChunkAck> {
    const result = await invokeUploadChunk(input);
    if (!result.success) {
      throw new StorageFunctionError(
        result.error || "Chunk upload failed",
        result.status,
      );
    }
    return {
      chunkIndex: asNumber(result.chunkIndex, input.chunkIndex),
      receivedIndexes: Array.isArray(result.receivedIndexes)
        ? result.receivedIndexes.map((n) => Number(n))
        : [input.chunkIndex],
      uploadedBytes: asNumber(result.uploadedBytes),
    };
  }

  async completeUpload(input: {
    uploadId: string;
    contentHash?: string | null;
  }): Promise<StoredDocumentRef & { documentId: string }> {
    const result = await invokeCompleteUpload(input);
    if (!result.success) {
      throw new StorageFunctionError(
        result.error || "Unable to finalize document storage.",
        result.status,
      );
    }
    const document = (result.document || {}) as Record<string, unknown>;
    return {
      documentId: asString(result.documentId || document.id),
      storageProvider: "azure",
      storageContainer: asString(document.storage_container) || null,
      storageBlobName: asString(document.storage_blob_name) || null,
      storageUrl: asString(document.storage_url) || null,
      mimeType: asString(document.mime_type) || null,
      fileSizeBytes:
        document.file_size_bytes == null
          ? null
          : asNumber(document.file_size_bytes),
      originalFileName: asString(document.original_file_name) || null,
    };
  }

  async abortUpload(input: { uploadId: string }): Promise<void> {
    const result = await invokeAbortUpload(input);
    if (!result.success && result.status !== 404) {
      throw new StorageFunctionError(
        result.error || "Unable to cancel upload.",
        result.status,
      );
    }
  }

  async delete(ref: StoredDocumentRef): Promise<void> {
    void ref;
    throw new Error("Use invokeDocumentDelete with a document id.");
  }

  async getDownloadUrl(_ref: StoredDocumentRef): Promise<string> {
    void _ref;
    throw new Error("Use the document read proxy for downloads.");
  }
}

export class StorageFunctionError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "StorageFunctionError";
    this.status = status;
  }
}

export function getDocumentStorageProvider(): DocumentStorageProvider {
  const provider = new EdgeFunctionDocumentStorageProvider();
  if (!provider.isConfigured()) {
    throw new StorageNotConfiguredError();
  }
  return provider;
}
