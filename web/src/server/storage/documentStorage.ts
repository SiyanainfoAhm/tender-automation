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
} from "@/lib/storage/documentStorageProvider";

export {
  buildCompanyDocumentBlobName,
  sanitizeBlobFileName,
  slugifyBlobSegment,
} from "@/lib/storage/blobPath";

export {
  invokeDocumentDelete,
  invokeDocumentUpload,
} from "@/server/storage/tenderAutomationDocumentFunctions";
