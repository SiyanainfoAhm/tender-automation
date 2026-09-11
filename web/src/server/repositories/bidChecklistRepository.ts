import "server-only";

import {
  buildChecklistSeedFromMissingDocuments,
  calculateSectionProgress,
  deriveCompletionSource,
  isFromScratchGeneratable,
  isRequirementCompleted,
  matchRequirementToDocuments,
  normalizeRequirementIdentityKey,
  resolveWorkspaceSection,
  type ChecklistCompletionStatus,
  type ChecklistCategory,
  type MatchableCompanyDoc,
  type MatchableWorkspaceDoc,
  type RequirementCompletionSource,
  type RequirementDestinationSection,
  type RequirementOrigin,
} from "@/lib/bid-checklist";
import type { BidWorkspaceDTO, WorkspaceDocumentRow } from "@/lib/bid-workspace";
import { getServerSupabase } from "@/lib/db/server";
import {
  listCompanyDocuments,
  type CompanyDocument,
} from "@/server/repositories/documentRepository";

export type ChecklistLinkedDocument = {
  id: string;
  title: string;
  fileName: string | null;
  status: string;
  versionLabel: string | null;
  source: "TENDER" | "COMPANY";
  hasFile: boolean;
  downloadHref: string | null;
  matchedBy: "AI" | "USER" | "SYSTEM" | null;
};

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
  manualCompleted: boolean;
  isCompleted: boolean;
  completionSource: RequirementCompletionSource;
  matchedDocumentSource: "COMPANY" | "TENDER" | null;
  matchedCompanyDocumentId: string | null;
  matchedWorkspaceDocumentId: string | null;
  matchedBy: "AI" | "USER" | "SYSTEM" | null;
  matchConfidence: number | null;
  matchReason: string | null;
  displayOrder: number;
  requirementOrigin: RequirementOrigin;
  aiDetected: boolean;
  workspaceSection: RequirementDestinationSection;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  documents: ChecklistLinkedDocument[];
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

function isActiveWorkspaceDoc(doc: WorkspaceDocumentRow): boolean {
  return (
    !doc.isPlaceholder &&
    doc.hasFile &&
    doc.status !== "pending"
  );
}

function mapChecklistRow(
  row: Record<string, unknown>,
  companyById: Map<string, CompanyDocument>,
  workspaceById: Map<string, WorkspaceDocumentRow>,
  linkedDocs: ChecklistLinkedDocument[],
): ChecklistItemRow {
  const companyId = row.matched_company_document_id
    ? String(row.matched_company_document_id)
    : null;
  const workspaceId = row.matched_workspace_document_id
    ? String(row.matched_workspace_document_id)
    : null;
  const company = companyId ? companyById.get(companyId) : null;
  const workspace = workspaceId ? workspaceById.get(workspaceId) : null;
  const manualCompleted = row.manual_completed === true;
  const completionStatus = String(
    row.completion_status || "MISSING",
  ) as ChecklistCompletionStatus;
  const matchedBy =
    (row.matched_by as "AI" | "USER" | "SYSTEM" | null) || null;
  const matchedDocumentSource =
    (row.matched_document_source as "COMPANY" | "TENDER" | null) || null;
  const hasWorkspaceDocument = linkedDocs.some((d) => d.source === "TENDER");
  const hasCompanyDocument = linkedDocs.some((d) => d.source === "COMPANY");
  const originRaw = String(row.requirement_origin || "AI").toUpperCase();
  const requirementOrigin: RequirementOrigin =
    originRaw === "MANUAL" || originRaw === "SEED" ? originRaw : "AI";
  const category = String(row.category || "COMPLIANCE");
  const workspaceSection = resolveWorkspaceSection({
    category,
    workspaceSection: row.workspace_section
      ? String(row.workspace_section)
      : null,
  });

  return {
    id: String(row.id),
    requirementKey: String(row.requirement_key),
    requirementName: String(row.requirement_name),
    category,
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
    completionStatus,
    manualCompleted,
    isCompleted: isRequirementCompleted({
      manualCompleted,
      completionStatus,
    }),
    completionSource: deriveCompletionSource({
      manualCompleted,
      matchedBy,
      matchedDocumentSource,
      hasWorkspaceDocument,
      hasCompanyDocument,
    }),
    matchedDocumentSource,
    matchedCompanyDocumentId: companyId,
    matchedWorkspaceDocumentId: workspaceId,
    matchedBy,
    matchConfidence:
      row.match_confidence == null ? null : Number(row.match_confidence),
    matchReason: row.match_reason ? String(row.match_reason) : null,
    displayOrder: Number(row.display_order || 0),
    requirementOrigin,
    aiDetected: row.ai_detected === true,
    workspaceSection,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdByName: null,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    documents: linkedDocs,
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

function collectLinkedDocuments(options: {
  itemId: string;
  matchedWorkspaceDocumentId: string | null;
  matchedCompanyDocumentId: string | null;
  matchedBy: "AI" | "USER" | "SYSTEM" | null;
  workspaceDocuments: WorkspaceDocumentRow[];
  companyById: Map<string, CompanyDocument>;
}): ChecklistLinkedDocument[] {
  const docs: ChecklistLinkedDocument[] = [];
  const seen = new Set<string>();

  for (const doc of options.workspaceDocuments) {
    const linked =
      doc.checklistItemId === options.itemId ||
      doc.id === options.matchedWorkspaceDocumentId;
    if (!linked) continue;
    if (doc.isPlaceholder || !doc.hasFile) continue;
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    docs.push({
      id: doc.id,
      title: doc.title,
      fileName: doc.fileName,
      status: doc.status,
      versionLabel: doc.versionLabel,
      source: "TENDER",
      hasFile: doc.hasFile,
      downloadHref: `/api/bid-workspace/documents/${doc.id}`,
      matchedBy: options.matchedBy,
    });
  }

  if (options.matchedCompanyDocumentId) {
    const company = options.companyById.get(options.matchedCompanyDocumentId);
    if (company && !seen.has(`company:${company.id}`)) {
      seen.add(`company:${company.id}`);
      docs.push({
        id: company.id,
        title: company.name,
        fileName: company.originalFileName,
        status: company.verificationStatus,
        versionLabel: null,
        source: "COMPANY",
        hasFile: true,
        downloadHref: `/api/documents/${company.id}`,
        matchedBy: options.matchedBy,
      });
    }
  }

  return docs.sort((a, b) => {
    const av = a.versionLabel || "";
    const bv = b.versionLabel || "";
    return bv.localeCompare(av);
  });
}

export function computeChecklistProgress(
  items: ChecklistItemRow[],
): ChecklistProgress {
  return calculateSectionProgress(items);
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
    .eq("workspace_id", options.workspaceId)
    .eq("is_archived", false);
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
      normalized_requirement_key: normalizeRequirementIdentityKey(
        seed.requirementKey,
        seed.requirementName,
      ),
      display_order: index + 1,
      requirement_origin: "SEED",
      workspace_section: resolveWorkspaceSection({
        category: seed.category,
      }),
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
    .eq("is_archived", false)
    .order("display_order", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data || [];
  if (rows.length === 0) return;

  const companyDocs = await listCompanyDocuments({
    companyId: options.companyId,
  });
  const matchableCompany = companyDocs.map(toMatchableCompany);
  const matchableWorkspace = options.workspaceDocuments
    .filter((doc) => !doc.isPlaceholder)
    .map(toMatchableWorkspace);

  for (const row of rows) {
    // Manual completion without docs stays completed.
    if (row.manual_completed === true) {
      continue;
    }

    // Explicit USER matches win unless the linked doc disappeared.
    if (row.matched_by === "USER") {
      const stillCompany =
        row.matched_company_document_id &&
        companyDocs.some((d) => d.id === row.matched_company_document_id);
      const stillWorkspace =
        row.matched_workspace_document_id &&
        options.workspaceDocuments.some(
          (d) =>
            d.id === row.matched_workspace_document_id &&
            isActiveWorkspaceDoc(d),
        );
      const linkedByFk = options.workspaceDocuments.some(
        (d) =>
          d.checklistItemId === String(row.id) && isActiveWorkspaceDoc(d),
      );
      if (stillCompany || stillWorkspace || linkedByFk) {
        if (
          row.completion_status !== "COMPLETED_COMPANY_DOCUMENT" &&
          row.completion_status !== "COMPLETED_TENDER_DOCUMENT"
        ) {
          const { error: promoteError } = await supabase
            .from("agenttender_bid_checklist_items")
            .update({
              completion_status: stillCompany
                ? "COMPLETED_COMPANY_DOCUMENT"
                : "COMPLETED_TENDER_DOCUMENT",
            })
            .eq("id", row.id)
            .eq("workspace_id", options.workspaceId);
          if (promoteError) throw new Error(promoteError.message);
        }
        continue;
      }
      // Linked docs gone → reopen unless manual.
      const { error: clearError } = await supabase
        .from("agenttender_bid_checklist_items")
        .update({
          completion_status: "MISSING",
          matched_document_source: null,
          matched_company_document_id: null,
          matched_workspace_document_id: null,
          matched_by: null,
          match_confidence: null,
          match_reason: "Linked document removed.",
        })
        .eq("id", row.id)
        .eq("workspace_id", options.workspaceId);
      if (clearError) throw new Error(clearError.message);
      continue;
    }

    // Preserve explicit AI links when the workspace document still exists.
    if (
      row.matched_by === "AI" &&
      row.matched_workspace_document_id &&
      options.workspaceDocuments.some(
        (d) =>
          d.id === row.matched_workspace_document_id && isActiveWorkspaceDoc(d),
      )
    ) {
      if (
        row.completion_status === "DRAFT_AVAILABLE" ||
        row.completion_status === "MISSING" ||
        row.completion_status === "PENDING_DOCUMENT"
      ) {
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

    // Prefer FK-linked active docs for this requirement.
    const fkDocs = options.workspaceDocuments.filter(
      (d) => d.checklistItemId === String(row.id) && isActiveWorkspaceDoc(d),
    );
    if (fkDocs.length > 0) {
      const primary = fkDocs[0]!;
      const { error: fkError } = await supabase
        .from("agenttender_bid_checklist_items")
        .update({
          completion_status: "COMPLETED_TENDER_DOCUMENT",
          matched_document_source: "TENDER",
          matched_company_document_id: null,
          matched_workspace_document_id: primary.id,
          matched_by: row.matched_by === "AI" ? "AI" : row.matched_by || "SYSTEM",
          match_confidence: 0.95,
          match_reason: `Linked tender document “${primary.title}”.`,
          generation_allowed: isFromScratchGeneratable({
            requirementKey: String(row.requirement_key),
            requirementName: String(row.requirement_name),
            generationAllowed: row.generation_allowed === true,
          }),
        })
        .eq("id", row.id)
        .eq("workspace_id", options.workspaceId);
      if (fkError) throw new Error(fkError.message);
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
        generation_allowed: fromScratch,
      })
      .eq("id", row.id)
      .eq("workspace_id", options.workspaceId);
    if (updateError) throw new Error(updateError.message);

    if (result.workspaceDocumentId) {
      await supabase
        .from("agenttender_bid_workspace_documents")
        .update({ checklist_item_id: row.id, is_placeholder: false })
        .eq("id", result.workspaceDocumentId)
        .eq("workspace_id", options.workspaceId);
    }
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
    .eq("is_archived", false)
    .order("display_order", { ascending: true });
  if (error) throw new Error(error.message);

  const companyDocs = await listCompanyDocuments({
    companyId: options.companyId,
  });
  const companyById = new Map(companyDocs.map((d) => [d.id, d]));
  const workspaceById = new Map(
    options.workspaceDocuments.map((d) => [d.id, d]),
  );

  const mapped = (data || []).map((row) => {
    const record = row as Record<string, unknown>;
    const matchedBy =
      (record.matched_by as "AI" | "USER" | "SYSTEM" | null) || null;
    const linkedDocs = collectLinkedDocuments({
      itemId: String(record.id),
      matchedWorkspaceDocumentId: record.matched_workspace_document_id
        ? String(record.matched_workspace_document_id)
        : null,
      matchedCompanyDocumentId: record.matched_company_document_id
        ? String(record.matched_company_document_id)
        : null,
      matchedBy,
      workspaceDocuments: options.workspaceDocuments,
      companyById,
    });
    return mapChecklistRow(record, companyById, workspaceById, linkedDocs);
  });

  const creatorIds = [
    ...new Set(
      mapped
        .map((item) => item.createdBy)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (creatorIds.length === 0) return mapped;

  const { data: users } = await supabase
    .from("agenttender_users")
    .select("id, full_name")
    .in("id", creatorIds);
  const nameById = new Map(
    (users || []).map((u) => [String(u.id), String(u.full_name || "").trim()]),
  );
  return mapped.map((item) => ({
    ...item,
    createdByName: item.createdBy
      ? nameById.get(item.createdBy) || null
      : null,
  }));
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

  if (options.workspaceDocumentId) {
    await supabase
      .from("agenttender_bid_workspace_documents")
      .update({
        checklist_item_id: options.itemId,
        is_placeholder: false,
      })
      .eq("id", options.workspaceDocumentId)
      .eq("workspace_id", options.workspaceId)
      .eq("company_id", options.companyId);
  }
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

  await supabase
    .from("agenttender_bid_workspace_documents")
    .update({
      checklist_item_id: options.itemId,
      is_placeholder: false,
    })
    .eq("id", options.workspaceDocumentId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId);
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
        manual_completed: true,
        manual_completed_at: new Date().toISOString(),
        manual_completed_by: options.userId,
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

  // Reopen: clear manual completion; keep docs if present.
  const stillLinked =
    Boolean(row.matched_company_document_id) ||
    Boolean(row.matched_workspace_document_id);
  const { error } = await supabase
    .from("agenttender_bid_checklist_items")
    .update({
      manual_completed: false,
      manual_completed_at: null,
      manual_completed_by: null,
      completion_status: stillLinked
        ? row.matched_company_document_id
          ? "COMPLETED_COMPANY_DOCUMENT"
          : "COMPLETED_TENDER_DOCUMENT"
        : "MISSING",
      matched_by: stillLinked ? row.matched_by : null,
      match_reason: stillLinked
        ? "Manual completion cleared; linked document retained."
        : "Reopened — marked as pending.",
    })
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}

/**
 * After a workspace document is deleted, clear matches pointing at it and
 * reopen requirements that are no longer satisfied (unless manually completed).
 */
export async function clearChecklistLinksForDeletedDocument(options: {
  workspaceId: string;
  companyId: string;
  documentId: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { data: rows, error } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("id, manual_completed, matched_company_document_id")
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .eq("matched_workspace_document_id", options.documentId);
  if (error) throw new Error(error.message);

  for (const row of rows || []) {
    const stillCompany = Boolean(row.matched_company_document_id);
    const manual = row.manual_completed === true;
    const { error: updateError } = await supabase
      .from("agenttender_bid_checklist_items")
      .update({
        matched_workspace_document_id: null,
        matched_document_source: stillCompany ? "COMPANY" : null,
        matched_by: stillCompany || manual ? "USER" : null,
        completion_status: manual
          ? "COMPLETED_TENDER_DOCUMENT"
          : stillCompany
            ? "COMPLETED_COMPANY_DOCUMENT"
            : "MISSING",
        match_reason: manual
          ? "Document removed; kept complete via manual mark."
          : stillCompany
            ? "Workspace document removed; company document retained."
            : "Linked document removed.",
      })
      .eq("id", row.id)
      .eq("workspace_id", options.workspaceId);
    if (updateError) throw new Error(updateError.message);
  }

  // Also clear FK on any remaining rows that pointed via checklist_item_id
  // (document row is already deleted; rematch will pick up remaining docs).
}

export type ManualRequirementInput = {
  workspaceId: string;
  companyId: string;
  tenderId: string;
  userId: string;
  title: string;
  section: RequirementDestinationSection;
  category?: string | null;
  description?: string | null;
  sourceReference?: string | null;
};

function assertDestinationSection(
  value: string,
): RequirementDestinationSection {
  if (
    value === "prequalification" ||
    value === "technical" ||
    value === "annexures"
  ) {
    return value;
  }
  throw new Error("Choose a valid destination section.");
}

function normalizeManualCategory(
  category: string | null | undefined,
  section: RequirementDestinationSection,
): ChecklistCategory {
  const raw = String(category || "").trim().toUpperCase();
  const allowed = new Set([
    "COMPLIANCE",
    "TECHNICAL",
    "FINANCIAL",
    "LEGAL",
    "EXPERIENCE",
    "ANNEXURE",
    "DECLARATION",
    "AUTHORIZATION",
    "CERTIFICATE",
    "EMD",
    "BOQ",
    "SERVICE",
    "OTHER",
  ]);
  if (raw && allowed.has(raw)) return raw as ChecklistCategory;
  if (section === "technical") return "TECHNICAL";
  if (section === "annexures") return "ANNEXURE";
  return "COMPLIANCE";
}

/** Create a first-class MANUAL checklist requirement. */
export async function createManualChecklistItem(
  options: ManualRequirementInput,
): Promise<{ id: string; identityKey: string }> {
  const title = options.title.trim();
  if (!title) throw new Error("Requirement title is required.");
  const section = assertDestinationSection(options.section);
  const category = normalizeManualCategory(options.category, section);
  const identity = normalizeRequirementIdentityKey("", title);
  const supabase = getServerSupabase();

  const { data: existingExact, error: exactError } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("id, requirement_name")
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .eq("is_archived", false)
    .eq("normalized_requirement_key", identity)
    .maybeSingle();
  if (exactError) throw new Error(exactError.message);
  if (existingExact?.id) {
    throw new Error(
      `A requirement with this title already exists: ${existingExact.requirement_name}`,
    );
  }

  const { data: archivedExact } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("id")
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .eq("is_archived", true)
    .eq("requirement_key", identity)
    .maybeSingle();

  const { data: maxOrderRow } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("display_order")
    .eq("workspace_id", options.workspaceId)
    .eq("is_archived", false)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = Number(maxOrderRow?.display_order || 0) + 1;
  const now = new Date().toISOString();
  const sourceRef = options.sourceReference?.trim() || null;

  const payload = {
    workspace_id: options.workspaceId,
    company_id: options.companyId,
    tender_id: options.tenderId,
    requirement_key: identity,
    requirement_name: title,
    category,
    description: options.description?.trim() || null,
    mandatory: true,
    document_type: category,
    generation_allowed: isFromScratchGeneratable({
      requirementKey: identity,
      requirementName: title,
      generationAllowed: false,
    }),
    source_clause: sourceRef,
    source_text: sourceRef,
    normalized_requirement_key: identity,
    display_order: nextOrder,
    completion_status: "MISSING",
    requirement_origin: "MANUAL",
    ai_detected: false,
    workspace_section: section,
    created_by: options.userId,
    updated_by: options.userId,
    updated_at: now,
    is_archived: false,
    archived_at: null,
    archived_by: null,
    manual_completed: false,
    manual_completed_at: null,
    manual_completed_by: null,
    matched_workspace_document_id: null,
    matched_company_document_id: null,
    matched_document_source: null,
    matched_by: null,
  };

  if (archivedExact?.id) {
    const { error } = await supabase
      .from("agenttender_bid_checklist_items")
      .update(payload)
      .eq("id", archivedExact.id)
      .eq("workspace_id", options.workspaceId);
    if (error) throw new Error(error.message);
    return { id: String(archivedExact.id), identityKey: identity };
  }

  const { data: inserted, error } = await supabase
    .from("agenttender_bid_checklist_items")
    .insert({
      ...payload,
      created_at: now,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: String(inserted.id), identityKey: identity };
}

export async function updateManualChecklistItem(options: {
  itemId: string;
  workspaceId: string;
  companyId: string;
  userId: string;
  title: string;
  section: RequirementDestinationSection;
  category?: string | null;
  description?: string | null;
  sourceReference?: string | null;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { data: row, error: loadError } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("id, requirement_origin")
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .eq("is_archived", false)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!row) throw new Error("Requirement not found.");
  if (String(row.requirement_origin) !== "MANUAL") {
    throw new Error("Only manually added requirements can be edited.");
  }

  const title = options.title.trim();
  if (!title) throw new Error("Requirement title is required.");
  const section = assertDestinationSection(options.section);
  const category = normalizeManualCategory(options.category, section);
  const identity = normalizeRequirementIdentityKey("", title);
  const sourceRef = options.sourceReference?.trim() || null;

  const { data: clash } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("id, requirement_name")
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .eq("is_archived", false)
    .eq("normalized_requirement_key", identity)
    .neq("id", options.itemId)
    .maybeSingle();
  if (clash?.id) {
    throw new Error(
      `A requirement with this title already exists: ${clash.requirement_name}`,
    );
  }

  const { error } = await supabase
    .from("agenttender_bid_checklist_items")
    .update({
      requirement_key: identity,
      requirement_name: title,
      category,
      description: options.description?.trim() || null,
      document_type: category,
      source_clause: sourceRef,
      source_text: sourceRef,
      normalized_requirement_key: identity,
      workspace_section: section,
      updated_by: options.userId,
      updated_at: new Date().toISOString(),
      generation_allowed: isFromScratchGeneratable({
        requirementKey: identity,
        requirementName: title,
        generationAllowed: false,
      }),
    })
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}

/**
 * Soft-delete a MANUAL requirement. Linked workspace documents are unlinked
 * (kept in the document library) — Azure blobs are never deleted here.
 */
export async function archiveManualChecklistItem(options: {
  itemId: string;
  workspaceId: string;
  companyId: string;
  userId: string;
}): Promise<{ linkedDocumentCount: number }> {
  const supabase = getServerSupabase();
  const { data: row, error: loadError } = await supabase
    .from("agenttender_bid_checklist_items")
    .select("id, requirement_origin")
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .eq("is_archived", false)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!row) throw new Error("Requirement not found.");
  if (String(row.requirement_origin) !== "MANUAL") {
    throw new Error("Only manually added requirements can be deleted.");
  }

  const { data: linkedDocs, error: docsError } = await supabase
    .from("agenttender_bid_workspace_documents")
    .select("id")
    .eq("workspace_id", options.workspaceId)
    .eq("checklist_item_id", options.itemId);
  if (docsError) throw new Error(docsError.message);
  const linkedDocumentCount = (linkedDocs || []).length;

  // Keep documents in the workspace library; only clear the requirement FK.
  if (linkedDocumentCount > 0) {
    const { error: unlinkError } = await supabase
      .from("agenttender_bid_workspace_documents")
      .update({ checklist_item_id: null })
      .eq("workspace_id", options.workspaceId)
      .eq("checklist_item_id", options.itemId);
    if (unlinkError) throw new Error(unlinkError.message);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("agenttender_bid_checklist_items")
    .update({
      is_archived: true,
      archived_at: now,
      archived_by: options.userId,
      updated_by: options.userId,
      updated_at: now,
      matched_workspace_document_id: null,
      matched_company_document_id: null,
      matched_document_source: null,
      matched_by: null,
    })
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);

  return { linkedDocumentCount };
}

export async function countLinkedDocumentsForChecklistItem(options: {
  itemId: string;
  workspaceId: string;
}): Promise<number> {
  const supabase = getServerSupabase();
  const { count, error } = await supabase
    .from("agenttender_bid_workspace_documents")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", options.workspaceId)
    .eq("checklist_item_id", options.itemId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
