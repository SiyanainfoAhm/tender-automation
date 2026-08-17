/**
 * Shared document upload settings.
 * Keep chunk/timeout/limit behavior here — not in React components.
 */

export const CHUNK_SIZE = 5 * 1024 * 1024;
export const UPLOAD_CHUNK_CONCURRENCY = 2;
export const MAX_CHUNK_RETRIES = 3;
export const UPLOAD_CHUNK_TIMEOUT_MS = 120_000;
export const CHUNK_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

/** Configurable company-document size cap (chunked uploads). */
export const MAX_DOCUMENT_UPLOAD_SIZE_MB = 100;
export const MAX_DOCUMENT_UPLOAD_BYTES =
  MAX_DOCUMENT_UPLOAD_SIZE_MB * 1024 * 1024;

/** Single-request uploads (experience / workspace) stay smaller. */
export const MAX_SINGLE_SHOT_UPLOAD_BYTES = 25 * 1024 * 1024;

export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
  "image/png",
  "image/jpeg",
  "image/jpg",
] as const;
