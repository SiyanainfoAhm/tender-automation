import "server-only";
import { cache } from "react";
import { getServerSupabase } from "@/lib/db/server";
export type WillBidTender = { id: string; title: string; organization: string | null; reference_no: string | null; closing_date: string | null };
/** Reuses the shared tender catalog and company-scoped submission contract. */
export const listWillBidTenders = cache(async (companyId: string): Promise<WillBidTender[]> => {
  const db = getServerSupabase();
  const submitted = await db.from("agenttender_bid_workspaces").select("tender_id").eq("company_id", companyId).eq("submission_status", "submitted");
  if (submitted.error) throw new Error(submitted.error.message);
  const excluded = new Set((submitted.data ?? []).map((row) => row.tender_id));
  const items: WillBidTender[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await db.from("agenttender_tenders").select("id,title,organization,reference_no,closing_date")
      .in("qualification_status", ["GO", "WILL_BID"]).order("closing_date", { ascending: true, nullsFirst: false }).order("id").range(from, from + 999);
    if (result.error) throw new Error(result.error.message);
    items.push(...(result.data ?? []).filter((row) => !excluded.has(row.id)));
    if ((result.data?.length ?? 0) < 1000) break;
  }
  return items;
});
