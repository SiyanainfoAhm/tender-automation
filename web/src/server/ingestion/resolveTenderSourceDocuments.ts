import "server-only";

import { classifyIngestedFile } from "@/server/ingestion/types";
import { getServerSupabase } from "@/lib/db/server";

/**
 * Tender Source Documents
 *   ├─ PDF / ZIP / DOCX / XLSX (portal archive)
 *   └─ uploaded source documents (tender + workspace)
 *
 * Resolved before Ingestion Service → OpenAI → Structured Results.
 */
export type TenderSourceDocument = {
  fileName: string;
  url: string;
  origin: "portal_archive" | "tender_upload" | "workspace_upload";
};

const SOURCE_KINDS = new Set([
  "pdf",
  "zip",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "csv",
  "pptx",
  "ppt",
  "image",
]);

function isIngestibleSource(fileName: string): boolean {
  return SOURCE_KINDS.has(classifyIngestedFile(fileName));
}

function pushUnique(
  out: TenderSourceDocument[],
  item: TenderSourceDocument,
): void {
  if (!item.url.trim() || !item.fileName.trim()) return;
  if (!isIngestibleSource(item.fileName)) return;
  const url = item.url.trim();
  const name = item.fileName.trim();
  if (
    out.some(
      (d) =>
        d.url === url || d.fileName.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return;
  }
  out.push({ ...item, url, fileName: name });
}

/**
 * Collect all tender source documents for the Document Ingestion Service.
 */
export async function resolveTenderSourceDocuments(options: {
  tenderId: string;
  companyId: string;
  workspaceId: string;
  documentsZipUrl: string | null | undefined;
}): Promise<TenderSourceDocument[]> {
  const out: TenderSourceDocument[] = [];
  const supabase = getServerSupabase();

  const zipUrl = options.documentsZipUrl?.trim();
  if (zipUrl) {
    pushUnique(out, {
      fileName: "Tender_All_Documents.zip",
      url: zipUrl,
      origin: "portal_archive",
    });
  }

  const { data: tenderUploads } = await supabase
    .from("agenttender_tender_documents")
    .select("file_name, original_name, storage_url, section")
    .eq("tender_id", options.tenderId)
    .eq("company_id", options.companyId)
    .not("storage_url", "is", null)
    .in("section", ["tender", "bidding", "financial"])
    .limit(24);

  for (const row of tenderUploads || []) {
    const url =
      typeof row.storage_url === "string" ? row.storage_url.trim() : "";
    const fileName =
      (typeof row.original_name === "string" && row.original_name.trim()) ||
      (typeof row.file_name === "string" && row.file_name.trim()) ||
      "";
    pushUnique(out, {
      fileName,
      url,
      origin: "tender_upload",
    });
  }

  const { data: workspaceUploads } = await supabase
    .from("agenttender_bid_workspace_documents")
    .select("title, file_name, storage_url")
    .eq("workspace_id", options.workspaceId)
    .not("storage_url", "is", null)
    .limit(24);

  for (const row of workspaceUploads || []) {
    const url =
      typeof row.storage_url === "string" ? row.storage_url.trim() : "";
    const fileName =
      (typeof row.file_name === "string" && row.file_name.trim()) ||
      (typeof row.title === "string" && row.title.trim()) ||
      "";
    pushUnique(out, {
      fileName,
      url,
      origin: "workspace_upload",
    });
  }

  return out;
}
