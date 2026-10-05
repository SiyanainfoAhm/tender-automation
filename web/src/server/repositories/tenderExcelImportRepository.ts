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
  const existingIds = new Set<string>();
  for (let start = 0; start < rows.length; start += 200) {
    const sourceTenderIds = rows
      .slice(start, start + 200)
      .map((row) => row.sourceTenderId);
    const { data, error } = await supabase
      .from("agenttender_tenders")
      .select("source_tender_id")
      .eq("source_portal", "TENDER247")
      .eq("source_region", "INDIAN")
      .eq("scraped_date", scrapedDate)
      .in("source_tender_id", sourceTenderIds);
    if (error) throw new Error(error.message || "Tender lookup failed");
    for (const existing of data || []) {
      if (existing.source_tender_id) existingIds.add(String(existing.source_tender_id));
    }
  }

  // New Excel rows enter the same verification queue as agent-scraped tenders.
  // Existing rows deliberately omit qualification_status so a reimport cannot
  // reset an established screening or submission decision.
  const newPayload = payload
    .filter((row) => !existingIds.has(row.source_tender_id))
    .map((row) => ({ ...row, qualification_status: "VERIFY" }));
  const existingPayload = payload.filter((row) =>
    existingIds.has(row.source_tender_id),
  );

  for (const batch of [newPayload, existingPayload]) {
    for (let start = 0; start < batch.length; start += 200) {
    const { error } = await supabase
      .from("agenttender_tenders")
      .upsert(batch.slice(start, start + 200), {
        onConflict: "source_portal,source_region,source_tender_id,scraped_date",
      });
    if (error) throw new Error(error.message || "Tender upsert failed");
    }
  }

  return { upserted: payload.length };
}
