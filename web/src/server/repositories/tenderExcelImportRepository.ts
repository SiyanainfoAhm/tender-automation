import "server-only";

import { getServerSupabase } from "@/lib/db/server";

export type ExcelTenderImportRow = {
  sourceTenderId: string;
  referenceNo: string | null;
  title: string;
  organization: string | null;
  locationText: string | null;
  city: string | null;
  state: string | null;
  closingDate: string | null;
  openingDate: string | null;
  tenderValue: number | null;
  tenderValueText: string | null;
  emdAmount: number | null;
  emdText: string | null;
  sourceUrl: string | null;
  category: string | null;
  rawMetadata: Record<string, unknown>;
};

export async function upsertExcelTenders(
  rows: ExcelTenderImportRow[],
  scrapedDate: string,
): Promise<{ upserted: number }> {
  if (rows.length === 0) return { upserted: 0 };

  const now = new Date().toISOString();
  const payload = rows.map((row) => ({
    source_portal: "TENDER247",
    source_region: "INDIAN",
    source_tender_id: row.sourceTenderId,
    folder_id: row.referenceNo || row.sourceTenderId,
    reference_no: row.referenceNo,
    title: row.title,
    organization: row.organization,
    location_text: row.locationText,
    city: row.city,
    state: row.state,
    opening_date: row.openingDate,
    closing_date: row.closingDate,
    bid_submission_date: row.closingDate,
    tender_value: row.tenderValue,
    tender_value_text: row.tenderValueText,
    emd_amount: row.emdAmount,
    emd_text: row.emdText,
    currency: "INR",
    source_url: row.sourceUrl,
    category: row.category,
    project_category: "Other",
    scraped_date: scrapedDate,
    raw_metadata: {
      ...row.rawMetadata,
      importSource: "EXCEL_UPLOAD",
      sourceFileDate: scrapedDate,
    },
    metadata_version: 1,
    content_hash: `excel-upload:${row.sourceTenderId}:${scrapedDate}`,
    last_seen_at: now,
    crawled_at: now,
    supabase_synced_at: now,
    download_status: "DISCOVERED",
    ai_summary_available: false,
    document_archive_available: false,
  }));

  const supabase = getServerSupabase();
  for (let start = 0; start < payload.length; start += 200) {
    const { error } = await supabase
      .from("agenttender_tenders")
      .upsert(payload.slice(start, start + 200), {
        onConflict: "source_portal,source_region,source_tender_id,scraped_date",
      });
    if (error) throw new Error(error.message || "Tender upsert failed");
  }

  return { upserted: payload.length };
}
