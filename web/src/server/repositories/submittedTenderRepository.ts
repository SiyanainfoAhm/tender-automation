import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import type {
  SubmittedTenderListItem,
  SubmittedTenderSummary,
} from "@/lib/submitted-tenders";
import {
  normalizeL1QcbsMethod,
  summarizeSubmittedTenders,
} from "@/lib/submitted-tenders";

function asString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const SUPABASE_IN_BATCH_SIZE = 200;

function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/**
 * Tender ids that belong on Submitted Tenders include every tender in a
 * submission outcome, plus company workspaces explicitly marked submitted.
 *
 * The status branch preserves manual and legacy submissions and keeps the
 * three post-submission qualification statuses visible after they change.
 */
async function resolveSubmittedTenderIds(
  companyId: string,
): Promise<string[]> {
  const supabase = getServerSupabase();
  const ids = new Set<string>();

  const [statusResult, workspaceResult] = await Promise.all([
    supabase
      .from("agenttender_tenders")
      .select("id")
      .in("qualification_status", [
        "SUBMITTED",
        "WON",
        "LOST",
      ]),
    supabase
      .from("agenttender_bid_workspaces")
      .select("tender_id")
      .eq("company_id", companyId)
      .eq("submission_status", "submitted"),
  ]);

  if (statusResult.error) {
    console.error(
      "[submitted-tenders] status id query failed",
      statusResult.error.message,
    );
  } else {
    for (const row of statusResult.data || []) {
      const id = asString(row.id);
      if (id) ids.add(id);
    }
  }

  if (workspaceResult.error) {
    console.error(
      "[submitted-tenders] workspace id query failed",
      workspaceResult.error.message,
    );
  } else {
    for (const row of workspaceResult.data || []) {
      const id = asString(row.tender_id);
      if (id) ids.add(id);
    }
  }

  return [...ids];
}

export async function countSubmittedTenders(
  companyId: string,
): Promise<number> {
  const supabase = getServerSupabase();
  const ids = await resolveSubmittedTenderIds(companyId);
  if (ids.length === 0) return 0;

  const results = await Promise.all(
    batches(ids, SUPABASE_IN_BATCH_SIZE).map((idBatch) =>
      supabase.from("agenttender_tenders").select("id").in("id", idBatch),
    ),
  );
  const error = results.find((result) => result.error)?.error;
  if (error) throw new Error(error.message);
  return results.reduce((total, result) => total + (result.data?.length || 0), 0);
}

export async function listSubmittedTenders(
  companyId: string,
): Promise<{
  items: SubmittedTenderListItem[];
  summary: SubmittedTenderSummary;
}> {
  const supabase = getServerSupabase();
  const ids = await resolveSubmittedTenderIds(companyId);
  if (ids.length === 0) {
    return { items: [], summary: summarizeSubmittedTenders([]) };
  }

  const idBatches = batches(ids, SUPABASE_IN_BATCH_SIZE);
  const [tenderResults, workspaceResults, wonResults] = await Promise.all([
    Promise.all(
      idBatches.map((idBatch) =>
        supabase
          .from("agenttender_tenders")
          .select(
            "id, title, reference_no, organization, source_portal, source_region, city, location_text, closing_date, tender_value, tender_type, category, project_category, scraped_date, qualification_status, raw_metadata, updated_at",
          )
          .in("id", idBatch),
      ),
    ),
    Promise.all(
      idBatches.map((idBatch) =>
        supabase
          .from("agenttender_bid_workspaces")
          .select("tender_id, submitted_at, submission_reference")
          .eq("company_id", companyId)
          .in("tender_id", idBatch),
      ),
    ),
    Promise.all(
      idBatches.map((idBatch) =>
        supabase
          .from("agenttender_won_projects")
          .select("id, tender_id")
          .eq("company_id", companyId)
          .in("tender_id", idBatch),
      ),
    ),
  ]);

  const tenderError = tenderResults.find((result) => result.error)?.error;
  if (tenderError) throw new Error(tenderError.message);

  const workspaceError = workspaceResults.find((result) => result.error)?.error;
  if (workspaceError) throw new Error(workspaceError.message);

  const wonError = wonResults.find((result) => result.error)?.error;
  if (wonError) throw new Error(wonError.message);

  type TenderRow = {
    id: string;
    title: string | null;
    reference_no: string | null;
    organization: string | null;
    source_portal: string | null;
    source_region: string | null;
    city: string | null;
    location_text: string | null;
    closing_date: string | null;
    tender_value: number | null;
    tender_type: string | null;
    category: string | null;
    project_category: string | null;
    scraped_date: string | null;
    qualification_status: string | null;
    raw_metadata: unknown;
    updated_at: string | null;
  };

  const tenderRows = tenderResults.flatMap((result) => result.data || []) as TenderRow[];

  const workspaceByTender = new Map<
    string,
    { submittedAt: string | null; submissionReference: string | null }
  >();
  for (const result of workspaceResults) {
    for (const row of result.data || []) {
      const tenderId = asString(row.tender_id);
      if (!tenderId) continue;
      workspaceByTender.set(tenderId, {
        submittedAt: asString(row.submitted_at),
        submissionReference: asString(row.submission_reference),
      });
    }
  }

  const wonByTender = new Map<string, string>();
  for (const result of wonResults) {
    for (const row of result.data || []) {
      const tenderId = asString(row.tender_id);
      const wonId = asString(row.id);
      if (tenderId && wonId) wonByTender.set(tenderId, wonId);
    }
  }

  const items: SubmittedTenderListItem[] = tenderRows.map((row) => {
    const meta =
      row.raw_metadata && typeof row.raw_metadata === "object"
        ? (row.raw_metadata as Record<string, unknown>)
        : {};
    const tenderId = String(row.id);
    const workspace = workspaceByTender.get(tenderId);
    const status = asString(row.qualification_status) || "SUBMITTED";
    return {
      id: tenderId,
      title: asString(row.title) || "Untitled tender",
      referenceNo: asString(row.reference_no),
      organization: asString(row.organization),
      portal: asString(row.source_portal),
      sourceRegion:
        row.source_region === "GLOBAL"
          ? "GLOBAL"
          : row.source_region === "INDIAN"
            ? "INDIAN"
            : null,
      location: asString(row.city) || asString(row.location_text) || null,
      closingDate: asString(row.closing_date),
      tenderType: asString(row.tender_type),
      evaluationMethod: normalizeL1QcbsMethod(asString(row.tender_type)),
      scrapedDate: asString(row.scraped_date)?.slice(0, 10) ?? null,
      tenderValue: asNumber(row.tender_value),
      qualificationStatus: status,
      submittedAt: workspace?.submittedAt ?? null,
      submissionReference: workspace?.submissionReference ?? null,
      lostReason: asString(meta.lostReason),
      wonProjectId: wonByTender.get(tenderId) ?? null,
      updatedAt: asString(row.updated_at),
    };
  });

  items.sort((a, b) => {
    const aTime = a.submittedAt || a.updatedAt || "";
    const bTime = b.submittedAt || b.updatedAt || "";
    return bTime.localeCompare(aTime);
  });

  return { items, summary: summarizeSubmittedTenders(items) };
}
