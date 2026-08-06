import { randomBytes } from "node:crypto";

export type AppErrorCode =
  | "DATABASE_QUERY_FAILED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "UNKNOWN";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly correlationId: string;
  readonly publicMessage: string;
  readonly cause?: unknown;

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
    this.publicMessage = options.publicMessage;
    this.cause = options.cause;
  }

  toPublicReference(): string {
    return `Unable to load tender data. Reference: ${this.correlationId}`;
  }
}

export function createCorrelationId(): string {
  return `STI-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toAppError(error: unknown, fallback?: Partial<AppError>): AppError {
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
