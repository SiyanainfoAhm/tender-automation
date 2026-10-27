import "server-only";
import { getServerSupabase } from "@/lib/db/server";
import type { ChecklistDocumentSource } from "@/lib/ai/checklist-document-chat";
import { ingestDocumentBytes } from "@/server/ingestion/extractFiles";
import { invokeDocumentRead, invokeWorkspaceDocumentRead } from "@/server/storage/tenderAutomationDocumentFunctions";

/** Resolve IDs against the company AND item before reading any bytes. No client URLs. */
export async function readChecklistAttachment(options: {
  companyId: string; workspaceId: string; requirementId: string;
  sourceDocument: ChecklistDocumentSource;
}): Promise<{ name: string; text: string }> {
  const db = getServerSupabase();
  const itemResult = await db.from("agenttender_bid_checklist_items")
    .select("matched_company_document_id, matched_workspace_document_id")
    .eq("id", options.requirementId).eq("workspace_id", options.workspaceId)
    .eq("company_id", options.companyId).eq("is_archived", false).maybeSingle();
  if (itemResult.error) throw new Error("Unable to verify the checklist attachment.");
  if (!itemResult.data) throw new Error("Checklist requirement not found.");
  const source = options.sourceDocument;
  let name: string;
  if (source.source === "TENDER") {
    const { data, error } = await db.from("agenttender_bid_workspace_documents")
      .select("id, checklist_item_id, file_name, title, is_placeholder")
      .eq("id", source.id).eq("workspace_id", options.workspaceId)
      .eq("company_id", options.companyId).maybeSingle();
    if (error || !data || data.is_placeholder ||
      (data.checklist_item_id !== options.requirementId && itemResult.data.matched_workspace_document_id !== source.id)) {
      throw new Error("This document is not attached to this checklist item.");
    }
    name = String(data.file_name || data.title || "");
  } else {
    if (itemResult.data.matched_company_document_id !== source.id) throw new Error("This company document is not attached to this checklist item.");
    const { data, error } = await db.from("agenttender_company_documents")
      .select("original_file_name, name").eq("id", source.id)
      .eq("company_id", options.companyId).eq("status", "active").maybeSingle();
    if (error || !data) throw new Error("Company document not found.");
    name = String(data.original_file_name || data.name || "");
  }
  if (!/\.(docx|pdf|txt)$/i.test(name)) throw new Error("Use a Word (.docx), text PDF, or TXT attachment. Images and scanned PDFs need readable text first.");
  const response = source.source === "TENDER" ? await invokeWorkspaceDocumentRead(source.id) : await invokeDocumentRead(source.id);
  if (!response.ok) throw new Error("Unable to read the attached document. Your session may have expired.");
  const maxBytes = 10 * 1024 * 1024;
  if (Number(response.headers.get("content-length") || 0) > maxBytes) throw new Error("Attachment exceeds the 10 MB editing limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The attached document is empty.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Attachment exceeds the 10 MB editing limit."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const extracted = await ingestDocumentBytes({fileName:name, bytes:Buffer.concat(chunks)});
  const text = extracted.map(file => file.text || "").join("\n\n").trim();
  if (!text) throw new Error("No readable text found in the attachment. Upload a text PDF or Word document first.");
  if (text.length > 60000) throw new Error("Attachment is too long to edit safely in one request. Split it into smaller documents first.");
  return { name, text };
}
