import "server-only";

import {
  normalizeRequirementIdentityKey,
  resolveRequirementPattern,
  type RequirementPattern,
} from "@/lib/bid-checklist";
import type { WorkspaceDocumentRow } from "@/lib/bid-workspace";
import { getServerSupabase } from "@/lib/db/server";
import { ingestDocumentBytes } from "@/server/ingestion/extractFiles";
import { buildStructuredAiResult } from "@/server/ingestion/structuredExtract";
import type {
  IngestedFile,
  StructuredAiResult,
  TenderIngestionResult,
} from "@/server/ingestion/types";
import { rematchChecklistItems } from "@/server/repositories/bidChecklistRepository";
import { invokeBlobRead } from "@/server/storage/tenderAutomationDocumentFunctions";

/** Prefer the raw Azure URL when given an app proxy path. */
function resolveStorageUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed.startsWith("/api/storage/blob")) return trimmed;
  try {
    const parsed = new URL(trimmed, "http://localhost");
    const nested = parsed.searchParams.get("url");
    return nested?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

async function fetchUrlBytes(url: string): Promise<Buffer> {
  const storageUrl = resolveStorageUrl(url);
  // Prefer Edge blob-read for Azure private URLs; fall back to direct fetch.
  try {
    const edge = await invokeBlobRead({
      storageUrl,
      disposition: "attachment",
    });
    if (edge.ok) {
      const ab = await edge.arrayBuffer();
      return Buffer.from(ab);
    }
  } catch {
    // fall through
  }
  if (storageUrl.startsWith("/")) {
    throw new Error("Failed to download tender document via storage proxy");
  }
  const res = await fetch(storageUrl);
  if (!res.ok) {
    throw new Error(`Failed to download tender document (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function loadWorkspaceDocumentsForRematch(
  workspaceId: string,
): Promise<WorkspaceDocumentRow[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_workspace_documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: String(row.id),
    documentType: String(row.document_type) as WorkspaceDocumentRow["documentType"],
    title: String(row.title || ""),
    fileName: row.file_name ? String(row.file_name) : null,
    fileSizeBytes:
      typeof row.file_size_bytes === "number" ? row.file_size_bytes : null,
    status: String(row.status || "pending") as WorkspaceDocumentRow["status"],
    isRequired: Boolean(row.is_required),
    versionLabel: row.version_label ? String(row.version_label) : null,
    hasFile: Boolean(row.storage_url || row.file_name || row.blob_name),
    updatedAt: String(row.updated_at || new Date().toISOString()),
    checklistItemId: row.checklist_item_id
      ? String(row.checklist_item_id)
      : null,
    isPlaceholder: row.is_placeholder === true,
  }));
}

function workspaceDocTypeForRequirement(
  key: string,
  category: string,
): RequirementPattern["workspaceDocType"] {
  const pattern = resolveRequirementPattern(key) ||
    resolveRequirementPattern(category);
  if (pattern) return pattern.workspaceDocType;
  if (/TECHNICAL|CERTIFICATE/i.test(category)) return "Technical";
  if (/ANNEXURE|DECLARATION/i.test(category)) return "Annexure";
  if (/COMPLIANCE|FINANCIAL|LEGAL|EXPERIENCE|EMD/i.test(category)) {
    return "Pre-Qualification";
  }
  return "Other";
}

export async function persistStructuredIngestion(options: {
  workspaceId: string;
  companyId: string;
  tenderId: string;
  userId: string;
  structured: StructuredAiResult;
  workspaceDocuments: WorkspaceDocumentRow[];
  replaceChecklist?: boolean;
}): Promise<void> {
  const supabase = getServerSupabase();

  if (options.replaceChecklist !== false) {
    const { data: existingRows, error: existingError } = await supabase
      .from("agenttender_bid_checklist_items")
      .select("id, requirement_key, normalized_requirement_key, manual_completed")
      .eq("workspace_id", options.workspaceId)
      .eq("company_id", options.companyId)
      .eq("is_archived", false);
    if (existingError) throw new Error(existingError.message);

    const existingByKey = new Map<string, { id: string; manualCompleted: boolean }>();
    for (const row of existingRows || []) {
      const key = String(
        row.normalized_requirement_key || row.requirement_key || "",
      );
      if (key) {
        existingByKey.set(key, {
          id: String(row.id),
          manualCompleted: row.manual_completed === true,
        });
      }
    }

    const seenKeys = new Set<string>();
    let order = 0;
    for (const item of options.structured.checklist) {
      const identity = normalizeRequirementIdentityKey(
        item.requirement_key,
        item.requirement_name,
      );
      if (seenKeys.has(identity)) continue;
      seenKeys.add(identity);
      order += 1;

      const existing = existingByKey.get(identity);
      const payload = {
        workspace_id: options.workspaceId,
        company_id: options.companyId,
        tender_id: options.tenderId,
        requirement_key: item.requirement_key || identity,
        requirement_name: item.requirement_name,
        category: item.category || "COMPLIANCE",
        description: item.description || null,
        mandatory: item.mandatory !== false,
        document_type: item.document_type || null,
        generation_allowed: item.generation_allowed === true,
        source_page: item.source_page ?? null,
        source_clause: item.source_clause || null,
        source_text: item.source_text || null,
        normalized_requirement_key: identity,
        display_order: order,
        is_archived: false,
      };

      if (existing) {
        const { error } = await supabase
          .from("agenttender_bid_checklist_items")
          .update(payload)
          .eq("id", existing.id)
          .eq("workspace_id", options.workspaceId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from("agenttender_bid_checklist_items")
          .insert({
            ...payload,
            completion_status: "MISSING",
          });
        if (error) throw new Error(error.message);
      }
    }

    // Archive obsolete requirements that still have no manual completion
    // and no linked documents — preserve user work otherwise.
    for (const [key, existing] of existingByKey) {
      if (seenKeys.has(key)) continue;
      if (existing.manualCompleted) continue;

      const { data: linkedDocs } = await supabase
        .from("agenttender_bid_workspace_documents")
        .select("id")
        .eq("workspace_id", options.workspaceId)
        .eq("checklist_item_id", existing.id)
        .limit(1);
      if (linkedDocs && linkedDocs.length > 0) continue;

      const { data: matched } = await supabase
        .from("agenttender_bid_checklist_items")
        .select("matched_workspace_document_id, matched_company_document_id")
        .eq("id", existing.id)
        .maybeSingle();
      if (
        matched?.matched_workspace_document_id ||
        matched?.matched_company_document_id
      ) {
        continue;
      }

      await supabase
        .from("agenttender_bid_checklist_items")
        .update({ is_archived: true })
        .eq("id", existing.id)
        .eq("workspace_id", options.workspaceId);
    }
  }

  // Annexure placeholders stay as internal slots (hidden from requirement cards).
  for (const annex of options.structured.annexures.slice(0, 20)) {
    const { data: existing } = await supabase
      .from("agenttender_bid_workspace_documents")
      .select("id")
      .eq("workspace_id", options.workspaceId)
      .eq("title", annex.title)
      .maybeSingle();
    if (existing?.id) continue;
    const { error } = await supabase.from("agenttender_bid_workspace_documents").insert({
      workspace_id: options.workspaceId,
      company_id: options.companyId,
      tender_id: options.tenderId,
      document_type: "Annexure",
      title: annex.title,
      status: "pending",
      is_required: annex.mandatory !== false,
      is_placeholder: true,
      created_by: options.userId,
      updated_by: options.userId,
    });
    if (error) throw new Error(error.message);
  }

  // Optional placeholder slots for generatable items — marked as placeholders
  // so they never appear as top-level requirement cards.
  for (const item of options.structured.checklist) {
    if (!item.generation_allowed) continue;
    const title = item.requirement_name;
    const { data: existing } = await supabase
      .from("agenttender_bid_workspace_documents")
      .select("id")
      .eq("workspace_id", options.workspaceId)
      .ilike("title", title)
      .maybeSingle();
    if (existing?.id) continue;
    const identity = normalizeRequirementIdentityKey(
      item.requirement_key,
      item.requirement_name,
    );
    const { data: checklistRow } = await supabase
      .from("agenttender_bid_checklist_items")
      .select("id")
      .eq("workspace_id", options.workspaceId)
      .eq("normalized_requirement_key", identity)
      .eq("is_archived", false)
      .maybeSingle();
    const { error } = await supabase.from("agenttender_bid_workspace_documents").insert({
      workspace_id: options.workspaceId,
      company_id: options.companyId,
      tender_id: options.tenderId,
      document_type: workspaceDocTypeForRequirement(
        item.requirement_key,
        item.category,
      ),
      title,
      status: "pending",
      is_required: item.mandatory !== false,
      is_placeholder: true,
      checklist_item_id: checklistRow?.id || null,
      created_by: options.userId,
      updated_by: options.userId,
    });
    if (error) throw new Error(error.message);
  }

  if (options.structured.cost_items.length) {
    const { count } = await supabase
      .from("agenttender_bid_boq_items")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", options.workspaceId);
    if ((count ?? 0) === 0) {
      const { error } = await supabase.from("agenttender_bid_boq_items").insert(
        options.structured.cost_items.slice(0, 40).map((item, index) => ({
          workspace_id: options.workspaceId,
          company_id: options.companyId,
          tender_id: options.tenderId,
          description: item.detail
            ? `${item.description}\n${item.detail}`
            : item.description,
          category: item.category || "Services",
          uom: item.uom || "Nos",
          quantity: item.quantity || 1,
          unit_rate: item.unit_rate || 0,
          gst_percent: 18,
          display_order: index + 1,
        })),
      );
      if (error) throw new Error(error.message);
    }
  }

  const freshWorkspaceDocs = await loadWorkspaceDocumentsForRematch(
    options.workspaceId,
  );
  await rematchChecklistItems({
    workspaceId: options.workspaceId,
    companyId: options.companyId,
    workspaceDocuments:
      freshWorkspaceDocs.length > 0
        ? freshWorkspaceDocs
        : options.workspaceDocuments,
  });
}

/**
 * Document Ingestion Service orchestrator:
 * Tender docs (zip/pdf/docx/xlsx/…) → extract → structured AI result →
 * checklist + annexures + cost items → company-doc match.
 */
export async function runTenderDocumentIngestion(options: {
  workspaceId: string;
  companyId: string;
  tenderId: string;
  userId: string;
  documentUrls: Array<{ fileName: string; url: string }>;
  workspaceDocuments: WorkspaceDocumentRow[];
  checklistPromptTemplate?: string | null;
  costPromptTemplate?: string | null;
}): Promise<TenderIngestionResult> {
  if (!options.documentUrls.length) {
    throw new Error(
      "No tender documents available to ingest. Upload/crawl Tender_All_Documents.zip or RFP files first.",
    );
  }

  const leafFiles: IngestedFile[] = [];
  for (const doc of options.documentUrls.slice(0, 8)) {
    const bytes = await fetchUrlBytes(doc.url);
    const expanded = await ingestDocumentBytes({
      fileName: doc.fileName,
      bytes,
    });
    leafFiles.push(...expanded);
  }

  const { structured, engine, warning } = await buildStructuredAiResult(
    leafFiles,
    {
      checklistPromptTemplate: options.checklistPromptTemplate,
      costPromptTemplate: options.costPromptTemplate,
    },
  );

  await persistStructuredIngestion({
    workspaceId: options.workspaceId,
    companyId: options.companyId,
    tenderId: options.tenderId,
    userId: options.userId,
    structured,
    workspaceDocuments: options.workspaceDocuments,
  });

  return {
    sourceFiles: leafFiles.map((f) => ({
      fileName: f.fileName,
      kind: f.kind,
      chars: f.text?.length || 0,
      path: f.path,
      parser: f.parser,
      error: f.error,
    })),
    structured,
    engine,
    warning,
  };
}
