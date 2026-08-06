import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { AppError, createCorrelationId } from "@/lib/errors/app-error";

export type DbQueryContext = {
  queryName: string;
  selectedColumns?: string | string[];
  filters?: Record<string, unknown>;
  correlationId?: string;
};

export function logSupabaseError(
  error: PostgrestError,
  context: DbQueryContext,
): AppError {
  const correlationId = context.correlationId ?? createCorrelationId();

  console.error(
    JSON.stringify({
      level: "error",
      correlationId,
      queryName: context.queryName,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      selectedColumns: context.selectedColumns,
      filters: context.filters,
    }),
  );

  return new AppError({
    code: "DATABASE_QUERY_FAILED",
    correlationId,
    publicMessage: `Unable to load tender data. Reference: ${correlationId}`,
    internalMessage: `[${correlationId}] ${context.queryName}: ${error.message}`,
    cause: error,
  });
}

export function assertSupabaseOk<T>(
  result: { data: T; error: PostgrestError | null },
  context: DbQueryContext,
): T {
  if (result.error) {
    throw logSupabaseError(result.error, context);
  }
  return result.data;
}

export type QueryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export async function runQuery<T>(
  queryName: string,
  fn: () => Promise<{ data: T; error: PostgrestError | null }>,
  context?: Omit<DbQueryContext, "queryName">,
): Promise<QueryResult<T>> {
  try {
    const result = await fn();
    if (result.error) {
      return {
        ok: false,
        error: logSupabaseError(result.error, {
          queryName,
          ...context,
        }),
      };
    }
    return { ok: true, data: (result.data ?? null) as T };
  } catch (error) {
    const correlationId = createCorrelationId();
    console.error(
      JSON.stringify({
        level: "error",
        correlationId,
        queryName,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return {
      ok: false,
      error: new AppError({
        code: "UNKNOWN",
        correlationId,
        publicMessage: `Unable to load tender data. Reference: ${correlationId}`,
        internalMessage: `[${correlationId}] ${queryName}: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      }),
    };
  }
}
