import type { AskAiSource } from "./ask-ai-stream";

/** Durable V2 history contains raw evidence; older UI history contains display sources. */
export function normalizeV2Sources(value: unknown): AskAiSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(x => x && typeof x === "object").map((s, index) => ({
    id: s.id || s.ref || `source-${index + 1}`,
    fileName: s.fileName || s.document || "Source document", pageCount: s.pageCount ?? null,
    documentName: s.documentName || s.document || s.fileName || "Source document",
    sourceId: s.sourceId || s.source_id || s.chunk_id || s.ref,
    sourceType: s.sourceType || s.source_type || (String(s.ref).startsWith("C") ? "COMPANY_DOCUMENT" : "TENDER_DOCUMENT"),
    pageNumber: s.pageNumber ?? s.page ?? null, section: s.section ?? null,
    documentUrl: /^https?:\/\//i.test(String(s.documentUrl || s.document_url || "")) ? s.documentUrl || s.document_url : null,
    excerpt: s.excerpt, tenderId: s.tenderId, companyId: s.companyId,
  }));
}

