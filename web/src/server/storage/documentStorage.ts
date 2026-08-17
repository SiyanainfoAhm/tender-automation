import "server-only";

/**
 * Document path helpers + unconfigured provider for unit tests.
 * Azure write ops go through tender-automation-company-documents Edge Function.
 */

export {
  StorageNotConfiguredError,
  UnconfiguredDocumentStorageProvider,
  buildCompanyBlobPath,
  type DocumentStorageProvider,
  type DocumentUploadInput,
  type StoredDocumentRef,
  type CreateUploadSessionInput,
  type UploadSessionRef,
  type UploadChunkInput,
  type UploadChunkAck,
} from "@/lib/storage/documentStorageProvider";

export {
  buildCompanyDocumentBlobName,
  sanitizeBlobFileName,
  slugifyBlobSegment,
} from "@/lib/storage/blobPath";

export {
  invokeAbortUpload,
  invokeCompleteUpload,
  invokeCreateUploadSession,
  invokeDocumentDelete,
  invokeDocumentUpload,
  invokeUploadChunk,
} from "@/server/storage/tenderAutomationDocumentFunctions";
