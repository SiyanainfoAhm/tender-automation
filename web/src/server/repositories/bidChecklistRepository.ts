import "server-only";

import {
  buildChecklistSeedFromMissingDocuments,
  isChecklistItemComplete,
  isFromScratchGeneratable,
  matchRequirementToDocuments,
  type ChecklistCompletionStatus,
  type MatchableCompanyDoc,
  type MatchableWorkspaceDoc,
} from "@/lib/bid-checklist";
import type { BidWorkspaceDTO, WorkspaceDocumentRow } from "@/lib/bid-workspace";
import { getServerSupabase } from "@/lib/db/server";
import {
  listCompanyDocuments,
  type CompanyDocument,
} from "@/server/repositories/documentRepository";

export type ChecklistItemRow = {
  id: string;
  requirementKey: string;
  requirementName: string;
  category: string;
  description: string | null;
  mandatory: boolean;
  documentType: string | null;
  generationAllowed: boolean;
  sourcePage: number | null;
  sourceClause: string | null;
  sourceText: string | null;
  completionStatus: ChecklistCompletionStatus;
  matchedDocumentSource: "COMPANY" | "TENDER" | null;
  matchedCompanyDocumentId: string | null;
  matchedWorkspaceDocumentId: string | null;
  matchedBy: "AI" | "USER" | "SYSTEM" | null;
  matchConfidence: number | null;
  matchReason: string | null;
  displayOrder: number;
  matchedCompanyDocument: {
    id: string;
    name: string;
    originalFileName: string | null;
    verificationStatus: string;
    expiryState: string;
  } | null;
  matchedWorkspaceDocument: {
    id: string;
    title: string;
    fileName: string | null;
    status: string;
  } | null;
};

export type ChecklistProgress = {
  completed: number;
  total: number;
  percent: number;
};

function mapChecklistRow(
  row: Record<string, unknown>,
  companyById: Map<string, CompanyDocument>,
  workspaceById: Map<string, WorkspaceDocumentRow>,
): ChecklistItemRow {
  const companyId = row.matched_company_document_id
    ? String(row.matched_company_document_id)
    : null;
  const workspaceId = row.matched_workspace_document_id
    ? String(row.matched_workspace_document_id)
    : null;
  const company = companyId ? companyById.get(companyId) : null;
  const workspace = workspaceId ? workspaceById.get(workspaceId) : null;
  return {
    id: String(row.id),
    requirementKey: String(row.requirement_key),
    requirementName: String(row.requirement_name),
    category: String(row.category || "COMPLIANCE"),
    description: row.description ? String(row.description) : null,
    mandatory: row.mandatory !== false,
    documentType: row.document_type ? String(row.document_type) : null,
    generationAllowed:
      row.generation_allowed === true ||
      isFromScratchGeneratable({
        requirementKey: String(row.requirement_key),
        requirementName: String(row.requirement_name),
        generationAllowed: row.generation_allowed === true,
      }),
    sourcePage: row.source_page == null ? null : Number(row.source_page),
    sourceClause: row.source_clause ? String(row.source_clause) : null,
    sourceText: row.source_text ? String(row.source_text) : null,
    completionStatus: String(
      row.completion_status || "MISSING",
    ) as ChecklistCompletionStatus,
    matchedDocumentSource: (row.matched_document_source as
      | "COMPANY"
      | "TENDER"
      | null) || null,
    matchedCompanyDocumentId: companyId,
    matchedWorkspaceDocumentId: workspaceId,
    matchedBy: (row.matched_by as "AI" | "USER" | "SYSTEM" | null) || null,
    matchConfidence:
      row.match_confidence == null ? null : Number(row.match_confidence),
    matchReason: row.match_reason ? String(row.match_reason) : null,
    displayOrder: Number(row.display_order || 0),
    matchedCompanyDocument: company
      ? {
          id: company.id,
          name: company.name,
          originalFileName: company.originalFileName,
          verificationStatus: company.verificationStatus,
          expiryState: company.expiryState,
        }
      : null,
    matchedWorkspaceDocument: workspace
      ? {
          id: workspace.id,
          title: workspace.title,
          fileName: workspace.fileName,
          status: workspace.status,
        }
      : null,
  };
}

function toMatchableCompany(doc: CompanyDocument): MatchableCompanyDoc {
  return {
    id: doc.id,
    name: doc.name,
    originalFileName: doc.originalFileName,
    documentCategory: doc.documentCategory,
    certificateType: doc.certificateType,
    documentType: doc.documentType,
    verificationStatus: doc.verificationStatus,
    expiryState: doc.expiryState,
    status: doc.status,
  };
}

function toMatchableWorkspace(doc: WorkspaceDocumentRow): MatchableWorkspaceDoc {
  return {
    id: doc.id,
    title: doc.title,
    fileName: doc.fileName,
    documentType: doc.documentType,
    status: doc.status,
    hasFile: doc.hasFile,
  };
}

export function computeChecklistProgress(
  items: ChecklistItemRow[],
): ChecklistProgress {
  const mandatory = items.filter((item) => item.mandatory);
  const total = mandatory.length;
  const completed = mandatory.filter((item) =>
    isChecklistItemComplete(item.completionStatus),
  ).length;
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export async function seedChecklistItemsIfEmpty(options: {
  workspaceId: string;
  companyId: string;
  tenderId: string;
  missingDocuments: unknown[];
}): Promise<void> {
  const supabase = getServerSupabase();
  const { count, error: countError } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", options.workspaceId);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0) return;

  const seeds = buildChecklistSeedFromMissingDocuments(
    options.missingDocuments,
  );
  if (seeds.length === 0) return;

  const { error } = await supabase.from("agenttender_bid_checklist_items").insert(
    seeds.map((seed, index) => ({
      workspace_id: options.workspaceId,
      company_id: options.companyId,
      tender_id: options.tenderId,
      requirement_key: seed.requirementKey,
      requirement_name: seed.requirementName,
      category: seed.category,
      mandatory: true,
      document_type: seed.documentType,
      generation_allowed: seed.generationAllowed,
      completion_status: "MISSING",
      display_order: index + 1,
    })),
  );
  if (error) throw new Error(error.message);
}

export async function rematchChecklistItems(options: {
  workspaceId: string;
  companyId: string;
  workspaceDocuments: WorkspaceDocumentRow[];
}): Promise<void> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("*")
    .eq("workspace_id", options.workspaceId)
    .order("display_order", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data || [];
  if (rows.length === 0) return;

  const companyDocs = await listCompanyDocuments({
    companyId: options.companyId,
  });
  const matchableCompany = companyDocs.map(toMatchableCompany);
  const matchableWorkspace = options.workspaceDocuments.map(
    toMatchableWorkspace,
  );

  for (const row of rows) {
    // Manual USER matches win unless the linked doc disappeared.
    if (row.matched_by === "USER") {
      const stillCompany =
        row.matched_company_document_id &&
        companyDocs.some((d) => d.id === row.matched_company_document_id);
      const stillWorkspace =
        row.matched_workspace_document_id &&
        options.workspaceDocuments.some(
          (d) => d.id === row.matched_workspace_document_id,
        );
      if (stillCompany || stillWorkspace) continue;
    }

    // Preserve explicit AI / USER links when the workspace document still exists.
    // Promote legacy DRAFT_AVAILABLE AI links to completed (document already satisfies).
    if (
      (row.matched_by === "AI" || row.matched_by === "USER") &&
      row.matched_workspace_document_id &&
      options.workspaceDocuments.some(
        (d) => d.id === row.matched_workspace_document_id && d.hasFile,
      )
    ) {
      if (row.completion_status === "DRAFT_AVAILABLE") {
        const { error: promoteError } = await supabase
          .from("agenttender_bid_checklist_items")
          .update({
            completion_status: "COMPLETED_TENDER_DOCUMENT",
            match_reason:
              row.match_reason ||
              "AI-generated document linked and marked complete.",
          })
          .eq("id", row.id)
          .eq("workspace_id", options.workspaceId);
        if (promoteError) throw new Error(promoteError.message);
      }
      continue;
    }

    const fromScratch = isFromScratchGeneratable({
      requirementKey: String(row.requirement_key),
      requirementName: String(row.requirement_name),
      generationAllowed: row.generation_allowed === true,
    });

    const result = matchRequirementToDocuments({
      requirementName: String(row.requirement_name),
      requirementKey: String(row.requirement_key),
      companyDocuments: matchableCompany,
      workspaceDocuments: matchableWorkspace,
      generationAllowed: fromScratch,
    });

    const { error: updateError } = await supabase
      .from("agenttender_bid_checklist_items")
      .update({
        completion_status: result.completionStatus,
        matched_document_source: result.source,
        matched_company_document_id: result.companyDocumentId,
        matched_workspace_document_id: result.workspaceDocumentId,
        matched_by: result.matched ? result.matchedBy : null,
        match_confidence: result.confidence || null,
        match_reason: result.reason,
        // Keep UI Generate button in sync with from-scratch policy.
        generation_allowed: fromScratch,
      })
      .eq("id", row.id)
      .eq("workspace_id", options.workspaceId);
    if (updateError) throw new Error(updateError.message);
  }
}

export async function listChecklistItems(options: {
  workspaceId: string;
  companyId: string;
  workspaceDocuments: WorkspaceDocumentRow[];
}): Promise<ChecklistItemRow[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("*")
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .order("display_order", { ascending: true });
  if (error) throw new Error(error.message);

  const companyDocs = await listCompanyDocuments({
    companyId: options.companyId,
  });
  const companyById = new Map(companyDocs.map((d) => [d.id, d]));
  const workspaceById = new Map(
    options.workspaceDocuments.map((d) => [d.id, d]),
  );

  return (data || []).map((row) =>
    mapChecklistRow(row as Record<string, unknown>, companyById, workspaceById),
  );
}

export async function loadChecklistForWorkspace(options: {
  workspace: BidWorkspaceDTO;
  companyId: string;
  missingDocuments: unknown[];
}): Promise<{
  items: ChecklistItemRow[];
  progress: ChecklistProgress;
  companyDocuments: CompanyDocument[];
}> {
  await seedChecklistItemsIfEmpty({
    workspaceId: options.workspace.id,
    companyId: options.companyId,
    tenderId: options.workspace.tenderId,
    missingDocuments: options.missingDocuments,
  });
  await rematchChecklistItems({
    workspaceId: options.workspace.id,
    companyId: options.companyId,
    workspaceDocuments: options.workspace.documents,
  });
  const items = await listChecklistItems({
    workspaceId: options.workspace.id,
    companyId: options.companyId,
    workspaceDocuments: options.workspace.documents,
  });
  const companyDocuments = await listCompanyDocuments({
    companyId: options.companyId,
  });
  return {
    items,
    progress: computeChecklistProgress(items),
    companyDocuments,
  };
}

export async function setChecklistManualMatch(options: {
  itemId: string;
  workspaceId: string;
  companyId: string;
  companyDocumentId?: string | null;
  workspaceDocumentId?: string | null;
}): Promise<void> {
  const supabase = getServerSupabase();
  const source = options.companyDocumentId
    ? "COMPANY"
    : options.workspaceDocumentId
      ? "TENDER"
      : null;
  const { error } = await supabase
    .from("agenttender_bid_checklist_items")
    .update({
      matched_document_source: source,
      matched_company_document_id: options.companyDocumentId || null,
      matched_workspace_document_id: options.workspaceDocumentId || null,
      matched_by: source ? "USER" : null,
      completion_status: source
        ? source === "COMPANY"
          ? "COMPLETED_COMPANY_DOCUMENT"
          : "COMPLETED_TENDER_DOCUMENT"
        : "MISSING",
      match_reason: source ? "Manually linked by user." : "Match cleared.",
      match_confidence: source ? 1 : null,
    })
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}

/**
 * Link a successfully persisted AI-generated tender document and mark the
 * checklist requirement complete (checked + strikethrough in UI).
 */
export async function setChecklistAiDraftMatch(options: {
  itemId: string;
  workspaceId: string;
  companyId: string;
  workspaceDocumentId: string;
  matchReason: string;
  generationMeta?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getServerSupabase();
  const reason = options.generationMeta
    ? `${options.matchReason} meta=${JSON.stringify(options.generationMeta).slice(0, 1500)}`
    : options.matchReason;
  const { error } = await supabase
    .from("agenttender_bid_checklist_items")
    .update({
      matched_document_source: "TENDER",
      matched_company_document_id: null,
      matched_workspace_document_id: options.workspaceDocumentId,
      matched_by: "AI",
      completion_status: "COMPLETED_TENDER_DOCUMENT",
      match_reason: reason,
      match_confidence: 0.95,
    })
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}

/** Manually toggle checklist completion without deleting linked documents. */
export async function setChecklistCompletionState(options: {
  itemId: string;
  workspaceId: string;
  companyId: string;
  completed: boolean;
  userId: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { data: row, error: loadError } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("*")
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!row) throw new Error("Checklist item not found.");

  if (options.completed) {
    const hasCompany = Boolean(row.matched_company_document_id);
    const hasWorkspace = Boolean(row.matched_workspace_document_id);
    const completionStatus = hasCompany
      ? "COMPLETED_COMPANY_DOCUMENT"
      : "COMPLETED_TENDER_DOCUMENT";
    const { error } = await supabase
      .from("agenttender_bid_checklist_items")
      .update({
        completion_status: completionStatus,
        matched_document_source: hasCompany
          ? "COMPANY"
          : hasWorkspace
            ? "TENDER"
            : row.matched_document_source,
        matched_by: "USER",
        match_reason: hasCompany || hasWorkspace
          ? "Manually marked complete by user."
          : "Manually marked complete (no document linked yet).",
        match_confidence: 1,
      })
      .eq("id", options.itemId)
      .eq("workspace_id", options.workspaceId)
      .eq("company_id", options.companyId);
    if (error) throw new Error(error.message);
    return;
  }

  // Uncheck: clear completion but keep document links.
  const stillLinked =
    Boolean(row.matched_company_document_id) ||
    Boolean(row.matched_workspace_document_id);
  const { error } = await supabase
    .from("agenttender_bid_checklist_items")
    .update({
      completion_status: stillLinked ? "PENDING_DOCUMENT" : "MISSING",
      matched_by: stillLinked ? "USER" : row.matched_by,
      match_reason: stillLinked
        ? "Completion cleared; linked document retained."
        : "Completion cleared.",
    })
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}
