"use server";

import { revalidatePath } from "next/cache";

import {
  CompanyAccessError,
  requireCompanySession,
} from "@/server/auth/company-access";
import { sessionHasPermission } from "@/server/auth/permissions";
import {
  indexCompanyDocument,
  indexCompanyKnowledge,
  indexCompanyProfile,
  indexTenderDocumentById,
  indexTenderKnowledge,
  type IndexSourceResult,
} from "@/server/ai/rag";

export type ReindexAiKnowledgeInput =
  | { scope: "company" }
  | { scope: "company_profile" }
  | { scope: "company_document"; documentId: string }
  | { scope: "tender"; tenderId: string }
  | {
      scope: "tender_document";
      tenderId: string;
      tenderDocumentId: string;
    };

function summarize(results: IndexSourceResult[]) {
  return results.map((row) => ({
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    status: row.status,
    chunkCount: row.chunkCount,
    skipped: row.skipped,
    contentHashPrefix: row.contentHash?.slice(0, 12) ?? null,
    totalMs: row.timings.totalMs,
    errorMessage: row.errorMessage ?? null,
  }));
}

/**
 * Manual AI knowledge reindex (admin/editor). No UI yet — Phase 3 backend only.
 */
export async function reindexAiKnowledgeAction(
  input: ReindexAiKnowledgeInput,
): Promise<
  | { ok: true; results: ReturnType<typeof summarize> }
  | { ok: false; error: string }
> {
  try {
    const session = await requireCompanySession();
    if (
      !sessionHasPermission(session, "documents.upload") &&
      !sessionHasPermission(session, "tenders.edit")
    ) {
      return { ok: false, error: "You do not have permission to reindex AI knowledge." };
    }

    const companyId = session.companyId;
    let results: IndexSourceResult[] = [];

    switch (input.scope) {
      case "company":
        results = await indexCompanyKnowledge(companyId);
        break;
      case "company_profile":
        results = [await indexCompanyProfile(companyId)];
        break;
      case "company_document":
        results = [
          await indexCompanyDocument({
            companyId,
            documentId: input.documentId,
          }),
        ];
        break;
      case "tender":
        results = await indexTenderKnowledge({
          tenderId: input.tenderId,
          companyId,
        });
        break;
      case "tender_document":
        results = [
          await indexTenderDocumentById({
            companyId,
            tenderId: input.tenderId,
            tenderDocumentId: input.tenderDocumentId,
          }),
        ];
        break;
      default:
        return { ok: false, error: "Unsupported reindex scope." };
    }

    revalidatePath("/tenders");
    revalidatePath("/documents");
    return { ok: true, results: summarize(results) };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Reindex failed.",
    };
  }
}
