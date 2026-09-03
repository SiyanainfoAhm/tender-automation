import "server-only";

import {
  createCorrelationId,
  logDiagnostic,
  toAppError,
} from "@/lib/errors/app-error";
import { getTenderById } from "@/server/repositories/tenderRepository";
import {
  derivedTenderLifecycleEvents,
  listTenderActivity,
} from "@/server/repositories/tenderActivityRepository";
import { getWorkspaceSummary } from "@/server/repositories/bidWorkspaceRepository";
import { mapTenderDetail } from "@/server/tenders/map-tender-detail";
import type { TenderDetailDTO } from "@/lib/tender-detail";

export type LoadTenderDetailResult =
  | { ok: true; tender: TenderDetailDTO; correlationId: string }
  | { ok: false; kind: "not_found"; correlationId: string }
  | {
      ok: false;
      kind: "backend";
      correlationId: string;
      publicMessage: string;
      error: Error;
    };

/** Shared loader for Tender Detail, AI Analysis, and Bid Workspace. */
export async function loadTenderDetail(options: {
  tenderId: string;
  companyId?: string | null;
  userId?: string | null;
  role?: string | null;
  sessionExpiresAt?: string | null;
  correlationId?: string;
  includeRawResult?: boolean;
}): Promise<TenderDetailDTO | null> {
  const result = await loadTenderDetailSafe(options);
  if (result.ok) return result.tender;
  if (result.kind === "not_found") return null;
  throw result.error;
}

/** Non-throwing variant for pages that need staged error UI. */
export async function loadTenderDetailSafe(options: {
  tenderId: string;
  companyId?: string | null;
  userId?: string | null;
  role?: string | null;
  sessionExpiresAt?: string | null;
  correlationId?: string;
  includeRawResult?: boolean;
}): Promise<LoadTenderDetailResult> {
  const correlationId = options.correlationId ?? createCorrelationId();

  logDiagnostic({
    level: "info",
    event: "tender_detail_load_start",
    correlationId,
    operation: "loadTenderDetail",
    tenderId: options.tenderId,
    userId: options.userId ?? null,
    companyId: options.companyId ?? null,
    role: options.role ?? null,
    sessionExists: Boolean(options.userId),
    sessionExpiresAt: options.sessionExpiresAt ?? null,
  });

  try {
    const data = await getTenderById(options.tenderId);
    if (!data) {
      logDiagnostic({
        level: "info",
        event: "tender_detail_not_found",
        correlationId,
        operation: "getTenderById",
        tenderId: options.tenderId,
        userId: options.userId ?? null,
        companyId: options.companyId ?? null,
        ok: false,
      });
      return { ok: false, kind: "not_found", correlationId };
    }

    const workspace = options.companyId
      ? await getWorkspaceSummary({
          tenderId: options.tenderId,
          companyId: options.companyId,
        }).catch((error) => {
          logDiagnostic({
            level: "warn",
            event: "tender_workspace_summary_failed",
            correlationId,
            operation: "getWorkspaceSummary",
            tenderId: options.tenderId,
            companyId: options.companyId ?? null,
            message: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
      : null;

    const storedActivity = await listTenderActivity({
      tenderId: options.tenderId,
      companyId: options.companyId,
    }).catch((error) => {
      logDiagnostic({
        level: "warn",
        event: "tender_activity_list_failed",
        correlationId,
        operation: "listTenderActivity",
        tenderId: options.tenderId,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    });

    const derived = derivedTenderLifecycleEvents({
      tenderId: options.tenderId,
      firstSeenAt:
        typeof data.tender.first_seen_at === "string"
          ? data.tender.first_seen_at
          : null,
      crawledAt:
        typeof data.tender.crawled_at === "string" ? data.tender.crawled_at : null,
      qualifiedAt:
        typeof data.qualification?.qualified_at === "string"
          ? data.qualification.qualified_at
          : null,
    });

    const seen = new Set<string>();
    const activity = [...storedActivity, ...derived]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      });

    const tender = mapTenderDetail({
      tender: data.tender,
      qualification: data.qualification,
      submitted: workspace?.submissionStatus === "submitted",
      workspaceId: workspace?.id ?? null,
      activity,
      includeRawResult: options.includeRawResult === true,
    });

    logDiagnostic({
      level: "info",
      event: "tender_detail_load_ok",
      correlationId,
      operation: "loadTenderDetail",
      tenderId: options.tenderId,
      userId: options.userId ?? null,
      companyId: options.companyId ?? null,
      ok: true,
      qualificationStatus: tender.qualificationStatus,
      archiveDocumentCount: tender.archiveDocuments.length,
    });

    return { ok: true, tender, correlationId };
  } catch (error) {
    const appError = toAppError(error, {
      correlationId,
      publicMessage: "Unable to load this tender.",
    });
    logDiagnostic({
      level: "error",
      event: "tender_detail_load_failed",
      correlationId: appError.correlationId,
      operation: "loadTenderDetail",
      tenderId: options.tenderId,
      userId: options.userId ?? null,
      companyId: options.companyId ?? null,
      message: appError.message,
      ok: false,
    });
    return {
      ok: false,
      kind: "backend",
      correlationId: appError.correlationId,
      publicMessage: appError.publicMessage,
      error: appError,
    };
  }
}
