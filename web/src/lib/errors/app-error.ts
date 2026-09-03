export type AppErrorCode =
  | "DATABASE_QUERY_FAILED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "NETWORK_FAILED"
  | "UNKNOWN";

/** Matches TF-20260903-A7K92D and legacy STI-* ids embedded in messages/logs. */
export const CORRELATION_ID_PATTERN =
  /\b(TF-\d{8}-[A-Z0-9]{6}|STI-[A-Z0-9]{6})\b/i;

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly correlationId: string;
  readonly publicMessage: string;
  readonly cause?: unknown;
  /** Next.js forwards `digest` to client error boundaries (custom fields are stripped). */
  digest: string;

  constructor(options: {
    code: AppErrorCode;
    publicMessage: string;
    internalMessage: string;
    correlationId?: string;
    cause?: unknown;
  }) {
    super(options.internalMessage);
    this.name = "AppError";
    this.code = options.code;
    this.correlationId = options.correlationId ?? createCorrelationId();
    this.publicMessage = options.publicMessage.includes(this.correlationId)
      ? options.publicMessage
      : `${options.publicMessage} Reference: ${this.correlationId}`;
    this.cause = options.cause;
    this.digest = this.correlationId;
  }

  toPublicReference(): string {
    return `Unable to load tender data. Reference: ${this.correlationId}`;
  }
}

/** Browser- and Node-safe correlation id: TF-YYYYMMDD-XXXXXX */
export function createCorrelationId(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    suffix = Array.from(bytes, (b) => alphabet[b % alphabet.length]!).join("");
  } else {
    for (let i = 0; i < 6; i += 1) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)]!;
    }
  }
  return `TF-${y}${m}${d}-${suffix}`;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function extractCorrelationId(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as {
    correlationId?: unknown;
    digest?: unknown;
    message?: unknown;
  };
  if (typeof record.correlationId === "string" && record.correlationId.trim()) {
    return record.correlationId.trim();
  }
  if (typeof record.digest === "string" && CORRELATION_ID_PATTERN.test(record.digest)) {
    return record.digest.match(CORRELATION_ID_PATTERN)![1]!.toUpperCase();
  }
  if (typeof record.message === "string") {
    const match = record.message.match(CORRELATION_ID_PATTERN);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
}

/** Always returns a displayable reference — never "unavailable". */
export function resolveDisplayReference(error: unknown): string {
  return extractCorrelationId(error) ?? createCorrelationId();
}

export function toAppError(
  error: unknown,
  fallback?: Partial<{
    code: AppErrorCode;
    publicMessage: string;
    correlationId: string;
  }>,
): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError({
    code: fallback?.code ?? "UNKNOWN",
    publicMessage:
      fallback?.publicMessage ?? "Something went wrong. Please try again.",
    internalMessage:
      error instanceof Error ? error.message : String(error),
    correlationId: fallback?.correlationId,
    cause: error,
  });
}

export type DiagnosticLogPayload = {
  level: "info" | "error" | "warn";
  event: string;
  correlationId: string;
  operation?: string;
  tenderId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  sessionExists?: boolean;
  sessionExpiresAt?: string | null;
  role?: string | null;
  httpStatus?: number | null;
  supabaseCode?: string | null;
  message?: string;
  ok?: boolean;
  timestamp?: string;
  [key: string]: unknown;
};

/** Structured diagnostics — never pass tokens/secrets. */
export function logDiagnostic(payload: DiagnosticLogPayload): void {
  const line = {
    ...payload,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };
  if (payload.level === "error") {
    console.error(JSON.stringify(line));
  } else if (payload.level === "warn") {
    console.warn(JSON.stringify(line));
  } else {
    console.info(JSON.stringify(line));
  }
}
