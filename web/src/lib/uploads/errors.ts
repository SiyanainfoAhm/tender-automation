export type UploadErrorCode =
  | "network"
  | "timeout"
  | "cancelled"
  | "file_too_large"
  | "unsupported_type"
  | "empty_file"
  | "validation"
  | "chunk_failed"
  | "session_expired"
  | "storage_unavailable"
  | "finalize_failed"
  | "metadata_failed"
  | "unknown";

export class UploadError extends Error {
  readonly code: UploadErrorCode;
  readonly retryable: boolean;

  constructor(
    code: UploadErrorCode,
    message: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "UploadError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

const STATUS_CODE_MAP: Record<number, { code: UploadErrorCode; message: string }> =
  {
    400: { code: "validation", message: "Upload request was rejected." },
    401: { code: "session_expired", message: "Upload session expired" },
    403: { code: "validation", message: "You do not have permission to upload documents." },
    404: { code: "session_expired", message: "Upload session expired" },
    408: { code: "timeout", message: "Network interrupted" },
    409: { code: "session_expired", message: "Upload session expired" },
    410: { code: "session_expired", message: "Upload session expired" },
    413: { code: "file_too_large", message: "File too large" },
    415: { code: "unsupported_type", message: "Unsupported type" },
    503: { code: "storage_unavailable", message: "Storage unavailable" },
  };

export function messageForUploadError(error: unknown): string {
  if (error instanceof UploadError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Upload failed";
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return (
    name === "AbortError" ||
    message.includes("aborted") ||
    message.includes("abort")
  );
}

export function uploadErrorFromUnknown(
  error: unknown,
  fallback: { code: UploadErrorCode; message: string } = {
    code: "unknown",
    message: "Chunk upload failed",
  },
): UploadError {
  if (error instanceof UploadError) return error;
  if (isAbortError(error)) {
    return new UploadError("cancelled", "Cancelled", { cause: error });
  }
  if (error instanceof TypeError) {
    return new UploadError("network", "Network interrupted", {
      retryable: true,
      cause: error,
    });
  }
  if (error instanceof Error && error.message) {
    return new UploadError(fallback.code, error.message, {
      retryable: fallback.code === "chunk_failed" || fallback.code === "network",
      cause: error,
    });
  }
  return new UploadError(fallback.code, fallback.message, { cause: error });
}

export function uploadErrorFromHttpStatus(
  status: number,
  serverMessage?: string | null,
): UploadError {
  if (status === 413) {
    return new UploadError("file_too_large", "File too large");
  }
  if (status === 415) {
    return new UploadError("unsupported_type", "Unsupported type");
  }
  if (status === 503) {
    return new UploadError(
      "storage_unavailable",
      serverMessage || "Storage unavailable",
    );
  }
  if (status === 401 || status === 404 || status === 409 || status === 410) {
    return new UploadError(
      "session_expired",
      serverMessage || "Upload session expired",
    );
  }
  const mapped = STATUS_CODE_MAP[status];
  const message =
    (serverMessage && serverMessage.trim()) ||
    mapped?.message ||
    (status >= 500 ? "Storage unavailable" : "Chunk upload failed");
  const code =
    mapped?.code ||
    (status >= 500 ? "storage_unavailable" : "chunk_failed");
  return new UploadError(code, message, {
    retryable: status >= 500 || status === 408 || status === 429,
  });
}
