import "server-only";

import {
  DEFAULT_PROPOSAL_SECTIONS,
  computeSubmissionReadiness,
  isDocumentReadyForSubmission,
  isProposalComplete,
  nextDocumentVersion,
  type BidSubmissionStatus,
  type BidWorkspaceDTO,
  type BoqItemRow,
  type ProposalSectionRow,
  type ProposalSectionStatus,
  type WorkspaceDocumentRow,
  type WorkspaceDocumentStatus,
  type WorkspaceDocumentType,
} from "@/lib/bid-workspace";
import { getServerSupabase } from "@/lib/db/server";
import { jsonArray } from "@/server/tenders/map-tender-detail";

export type WorkspaceSummary = {
  id: string;
  submissionStatus: BidSubmissionStatus;
  submittedAt: string | null;
};

export type { BidWorkspaceDTO };

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function getWorkspaceSummary(options: {
  tenderId: string;
  companyId: string;
}): Promise<WorkspaceSummary | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_workspaces")
    .select("id, submission_status, submitted_at")
    .eq("tender_id", options.tenderId)
    .eq("company_id", options.companyId)
    .maybeSingle();
  if (error) {
    console.error("[bid-workspace] summary failed", error.message);
    return null;
  }
  if (!data) return null;
  return {
    id: String(data.id),
    submissionStatus:
      data.submission_status === "submitted" ? "submitted" : "not_submitted",
    submittedAt: data.submitted_at ? String(data.submitted_at) : null,
  };
}

async function seedProposalSections(options: {
  workspaceId: string;
  companyId: string;
  tenderId: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const rows = DEFAULT_PROPOSAL_SECTIONS.map((section, index) => ({
    workspace_id: options.workspaceId,
    company_id: options.companyId,
    tender_id: options.tenderId,
    section_key: section.sectionKey,
    title: section.title,
    display_order: index + 1,
    content: "",
    status: "draft",
  }));
  const { error } = await supabase
    .from("agenttender_bid_proposal_sections")
    .insert(rows);
  if (error) throw new Error(error.message);
}

async function seedRequiredDocuments(options: {
  workspaceId: string;
  companyId: string;
  tenderId: string;
  missingDocuments: unknown[];
}): Promise<void> {
  const titles = options.missingDocuments
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return String(record.name || record.title || record.document || "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 20);

  if (titles.length === 0) return;

  const supabase = getServerSupabase();
  const { error } = await supabase.from("agenttender_bid_workspace_documents").insert(
    titles.map((title) => ({
      workspace_id: options.workspaceId,
      company_id: options.companyId,
      tender_id: options.tenderId,
      document_type: "Other",
      title,
      status: "pending",
      is_required: true,
    })),
  );
  if (error) throw new Error(error.message);
}

export async function getOrCreateWorkspace(options: {
  tenderId: string;
  companyId: string;
  userId: string;
  missingDocuments?: unknown[];
}): Promise<{ workspaceId: string; created: boolean }> {
  const existing = await getWorkspaceSummary(options);
  if (existing) return { workspaceId: existing.id, created: false };

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_workspaces")
    .insert({
      company_id: options.companyId,
      tender_id: options.tenderId,
      workspace_status: "active",
      submission_status: "not_submitted",
      created_by: options.userId,
      updated_by: options.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const raced = await getWorkspaceSummary(options);
      if (raced) return { workspaceId: raced.id, created: false };
    }
    throw new Error(error.message);
  }

  await seedProposalSections({
    workspaceId: data.id,
    companyId: options.companyId,
    tenderId: options.tenderId,
  });
  await seedRequiredDocuments({
    workspaceId: data.id,
    companyId: options.companyId,
    tenderId: options.tenderId,
    missingDocuments: options.missingDocuments ?? [],
  });

  return { workspaceId: data.id, created: true };
}

function mapSection(row: Record<string, unknown>): ProposalSectionRow {
  const content = String(row.content || "");
  const stored = row.status === "complete" ? "complete" : "draft";
  return {
    id: String(row.id),
    sectionKey: String(row.section_key),
    title: String(row.title),
    displayOrder: asNumber(row.display_order),
    content,
    status: stored === "complete" || isProposalComplete(content) ? "complete" : "draft",
    updatedAt: String(row.updated_at),
  };
}

function mapBoq(row: Record<string, unknown>): BoqItemRow {
  return {
    id: String(row.id),
    description: String(row.description || ""),
    category: String(row.category || "Other"),
    uom: String(row.uom || "Nos"),
    quantity: asNumber(row.quantity),
    unitRate: asNumber(row.unit_rate),
    gstPercent: asNumber(row.gst_percent),
    notes: row.notes ? String(row.notes) : null,
    displayOrder: asNumber(row.display_order),
  };
}

function mapDocument(row: Record<string, unknown>): WorkspaceDocumentRow {
  const status = String(row.status || "pending") as WorkspaceDocumentStatus;
  return {
    id: String(row.id),
    documentType: String(row.document_type || "Other") as WorkspaceDocumentType,
    title: String(row.title || "Document"),
    fileName: row.file_name ? String(row.file_name) : null,
    fileSizeBytes: row.file_size_bytes == null ? null : asNumber(row.file_size_bytes),
    status: [
      "drafting",
      "pending",
      "ready",
      "approved",
    ].includes(status)
      ? status
      : "pending",
    isRequired: Boolean(row.is_required),
    versionLabel: row.version_label ? String(row.version_label) : null,
    hasFile: Boolean(row.blob_name || row.file_name),
    updatedAt: String(row.updated_at),
  };
}

function pqCounts(qualification: Record<string, unknown> | null): {
  matched: number;
  mandatory: number;
} {
  if (!qualification) return { matched: 0, mandatory: 0 };
  const matched = jsonArray(qualification.matched_criteria).length;
  const failed = jsonArray(qualification.failed_criteria).length;
  const missing = jsonArray(qualification.missing_documents).length;
  return { matched, mandatory: matched + failed + missing };
}

export async function loadBidWorkspace(options: {
  workspaceId: string;
  companyId: string;
  qualification?: Record<string, unknown> | null;
}): Promise<BidWorkspaceDTO | null> {
  const supabase = getServerSupabase();
  const { data: workspace, error } = await supabase
    .from("agenttender_bid_workspaces")
    .select("*")
    .eq("id", options.workspaceId)
    .eq("company_id", options.companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!workspace) return null;

  const [sectionsRes, boqRes, docsRes] = await Promise.all([
    supabase
      .from("agenttender_bid_proposal_sections")
      .select("*")
      .eq("workspace_id", options.workspaceId)
      .eq("company_id", options.companyId)
      .order("display_order", { ascending: true }),
    supabase
      .from("agenttender_bid_boq_items")
      .select("*")
      .eq("workspace_id", options.workspaceId)
      .eq("company_id", options.companyId)
      .order("display_order", { ascending: true }),
    supabase
      .from("agenttender_bid_workspace_documents")
      .select("*")
      .eq("workspace_id", options.workspaceId)
      .eq("company_id", options.companyId)
      .order("created_at", { ascending: true }),
  ]);

  if (sectionsRes.error) throw new Error(sectionsRes.error.message);
  if (boqRes.error) throw new Error(boqRes.error.message);
  if (docsRes.error) throw new Error(docsRes.error.message);

  const sections = (sectionsRes.data || []).map((row) =>
    mapSection(row as Record<string, unknown>),
  );
  const boqItems = (boqRes.data || []).map((row) =>
    mapBoq(row as Record<string, unknown>),
  );
  const documents = (docsRes.data || []).map((row) =>
    mapDocument(row as Record<string, unknown>),
  );
  const requiredDocs = documents.filter((doc) => doc.isRequired);
  const pq = pqCounts(options.qualification ?? null);

  return {
    id: String(workspace.id),
    tenderId: String(workspace.tender_id),
    companyId: String(workspace.company_id),
    submissionStatus:
      workspace.submission_status === "submitted" ? "submitted" : "not_submitted",
    submittedAt: workspace.submitted_at ? String(workspace.submitted_at) : null,
    submissionReference: workspace.submission_reference
      ? String(workspace.submission_reference)
      : null,
    submissionNotes: workspace.submission_notes
      ? String(workspace.submission_notes)
      : null,
    updatedAt: String(workspace.updated_at),
    sections,
    boqItems,
    documents,
    readiness: computeSubmissionReadiness({
      proposalCompleted: sections.filter((section) => section.status === "complete")
        .length,
      proposalTotal: sections.length || DEFAULT_PROPOSAL_SECTIONS.length,
      boqLineCount: boqItems.length,
      documentsReady: requiredDocs.filter((doc) =>
        isDocumentReadyForSubmission(doc.status, doc.hasFile),
      ).length,
      documentsRequired: requiredDocs.length,
      pqMatched: pq.matched,
      pqMandatory: pq.mandatory,
    }),
  };
}

export async function updateProposalSection(options: {
  sectionId: string;
  workspaceId: string;
  companyId: string;
  userId: string;
  content: string;
}): Promise<ProposalSectionRow> {
  const supabase = getServerSupabase();
  const status: ProposalSectionStatus = isProposalComplete(options.content)
    ? "complete"
    : "draft";
  const { data, error } = await supabase
    .from("agenttender_bid_proposal_sections")
    .update({
      content: options.content,
      status,
      updated_by: options.userId,
    })
    .eq("id", options.sectionId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await touchWorkspace(options.workspaceId, options.companyId, options.userId);
  return mapSection(data as Record<string, unknown>);
}

export async function insertBoqItem(options: {
  workspaceId: string;
  companyId: string;
  tenderId: string;
  userId: string;
  description: string;
  category: string;
  uom: string;
  quantity: number;
  unitRate: number;
  gstPercent: number;
  notes: string | null;
}): Promise<BoqItemRow> {
  const supabase = getServerSupabase();
  const { data: last } = await supabase
    .from("agenttender_bid_boq_items")
    .select("display_order")
    .eq("workspace_id", options.workspaceId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("agenttender_bid_boq_items")
    .insert({
      workspace_id: options.workspaceId,
      company_id: options.companyId,
      tender_id: options.tenderId,
      description: options.description,
      category: options.category,
      uom: options.uom,
      quantity: options.quantity,
      unit_rate: options.unitRate,
      gst_percent: options.gstPercent,
      notes: options.notes,
      display_order: asNumber(last?.display_order) + 1,
      updated_by: options.userId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await touchWorkspace(options.workspaceId, options.companyId, options.userId);
  return mapBoq(data as Record<string, unknown>);
}

export async function updateBoqItem(options: {
  itemId: string;
  workspaceId: string;
  companyId: string;
  userId: string;
  description: string;
  category: string;
  uom: string;
  quantity: number;
  unitRate: number;
  gstPercent: number;
  notes: string | null;
}): Promise<BoqItemRow> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_boq_items")
    .update({
      description: options.description,
      category: options.category,
      uom: options.uom,
      quantity: options.quantity,
      unit_rate: options.unitRate,
      gst_percent: options.gstPercent,
      notes: options.notes,
      updated_by: options.userId,
    })
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await touchWorkspace(options.workspaceId, options.companyId, options.userId);
  return mapBoq(data as Record<string, unknown>);
}

export async function deleteBoqItem(options: {
  itemId: string;
  workspaceId: string;
  companyId: string;
  userId: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_bid_boq_items")
    .delete()
    .eq("id", options.itemId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
  await touchWorkspace(options.workspaceId, options.companyId, options.userId);
}

export async function getWorkspaceDocumentForCompany(options: {
  documentId: string;
  companyId: string;
}): Promise<Record<string, unknown> | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_workspace_documents")
    .select("*")
    .eq("id", options.documentId)
    .eq("company_id", options.companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

export async function updateWorkspaceDocumentStatus(options: {
  documentId: string;
  workspaceId: string;
  companyId: string;
  userId: string;
  status: WorkspaceDocumentStatus;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_bid_workspace_documents")
    .update({
      status: options.status,
      updated_by: options.userId,
    })
    .eq("id", options.documentId)
    .eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
  await touchWorkspace(options.workspaceId, options.companyId, options.userId);
}

export async function markWorkspaceSubmitted(options: {
  workspaceId: string;
  companyId: string;
  userId: string;
  submissionReference: string;
  submittedAt: string;
  notes: string | null;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_bid_workspaces")
    .update({
      submission_status: "submitted",
      workspace_status: "locked",
      submitted_at: options.submittedAt,
      submission_reference: options.submissionReference,
      submission_notes: options.notes,
      submitted_by: options.userId,
      updated_by: options.userId,
    })
    .eq("id", options.workspaceId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}

export async function nextWorkspaceDocumentVersion(options: {
  documentId: string;
  companyId: string;
}): Promise<string> {
  const row = await getWorkspaceDocumentForCompany(options);
  return nextDocumentVersion(
    row?.version_label ? String(row.version_label) : null,
  );
}

async function touchWorkspace(
  workspaceId: string,
  companyId: string,
  userId: string,
): Promise<void> {
  const supabase = getServerSupabase();
  await supabase
    .from("agenttender_bid_workspaces")
    .update({ updated_by: userId })
    .eq("id", workspaceId)
    .eq("company_id", companyId);
}
