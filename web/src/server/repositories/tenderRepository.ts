import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import { PROJECT_CATEGORIES, isProjectCategory } from "@/lib/project-category";
import { assertSupabaseOk } from "@/lib/errors/db-query";
import { resolveCreatedDateRange } from "@/lib/tender-date-filter";
import { resolveTenderSortColumn } from "@/lib/tender-sort";
import { qualificationStatusesForFilter } from "@/lib/tender-status";
import type { TenderFilters } from "@/lib/validations";
import { startOfDay, endOfDay, subDays, addDays, formatISO } from "date-fns";

export type WebTenderListRow = {
  id: string;
  source_portal: "TENDER247" | "BIDASSIST";
  source_tender_id: string;
  folder_id: string | null;
  title: string;
  organization: string | null;
  department: string | null;
  authority: string | null;
  category: string | null;
  project_category: string | null;
  city: string | null;
  state: string | null;
  location_text: string | null;
  published_date: string | null;
  opening_date: string | null;
  closing_date: string | null;
  bid_submission_date: string | null;
  tender_value: number | null;
  tender_value_text: string | null;
  emd_amount: number | null;
  emd_text: string | null;
  currency: string;
  source_url: string | null;
  download_status: string;
  qualification_status: string | null;
  prescreen_status: string | null;
  prescreen_reason_code: string | null;
  prescreen_reason: string | null;
  chatgpt_eligible: boolean | null;
  decision_source: string | null;
  prescreened_at: string | null;
  prescreen_rules_version: string | null;
  decision_label: string | null;
  verdict: string | null;
  reason: string | null;
  required_action: string | null;
  confidence: number | null;
  manual_review_required: boolean | null;
  qualified_at: string | null;
  crawled_at: string | null;
  created_at: string;
  first_seen_at: string | null;
  updated_at: string;
  effective_qualification_status: string | null;
  chat_url: string | null;
};

/** Columns needed for the tender table — avoid RFP text, AI JSON, archives. */
export const WEB_TENDER_LIST_SELECT = [
  "id",
  "source_portal",
  "source_tender_id",
  "folder_id",
  "title",
  "organization",
  "authority",
  "category",
  "project_category",
  "city",
  "state",
  "location_text",
  "closing_date",
  "tender_value",
  "tender_value_text",
  "emd_amount",
  "emd_text",
  "qualification_status",
  "confidence",
  "created_at",
  "first_seen_at",
  "crawled_at",
  "updated_at",
  "effective_qualification_status",
].join(",");

const SORTABLE: Record<string, string> = {
  title: "title",
  closing_date: "closing_date",
  opening_date: "opening_date",
  tender_value: "tender_value",
  emd_amount: "emd_amount",
  updated_at: "updated_at",
  crawled_at: "crawled_at",
  first_seen_at: "first_seen_at",
  created_at: "created_at",
  created: "created_at",
  qualification_status: "effective_qualification_status",
  source_portal: "source_portal",
  confidence: "confidence",
  organization: "organization",
  // URL-friendly keys
  source: "source_portal",
  status: "effective_qualification_status",
  closing: "closing_date",
  value: "tender_value",
  emd: "emd_amount",
  match: "confidence",
};

function applyQuickDate(
  filters: TenderFilters,
): { dateType: string; from?: string; to?: string } {
  const today = new Date();
  if (!filters.quickDate) {
    return {
      dateType: filters.dateType,
      from: filters.from,
      to: filters.to,
    };
  }
  switch (filters.quickDate) {
    case "today":
      return {
        dateType: "crawled_at",
        from: formatISO(startOfDay(today)),
        to: formatISO(endOfDay(today)),
      };
    case "last_7":
      return {
        dateType: "crawled_at",
        from: formatISO(startOfDay(subDays(today, 7))),
        to: formatISO(endOfDay(today)),
      };
    case "last_30":
      return {
        dateType: "crawled_at",
        from: formatISO(startOfDay(subDays(today, 30))),
        to: formatISO(endOfDay(today)),
      };
    case "closing_today":
      return {
        dateType: "closing_date",
        from: formatISO(startOfDay(today), { representation: "date" }),
        to: formatISO(endOfDay(today), { representation: "date" }),
      };
    case "closing_3":
      return {
        dateType: "closing_date",
        from: formatISO(startOfDay(today), { representation: "date" }),
        to: formatISO(endOfDay(addDays(today, 3)), { representation: "date" }),
      };
    case "closing_7":
      return {
        dateType: "closing_date",
        from: formatISO(startOfDay(today), { representation: "date" }),
        to: formatISO(endOfDay(addDays(today, 7)), { representation: "date" }),
      };
    case "closing_30":
      return {
        dateType: "closing_date",
        from: formatISO(startOfDay(today), { representation: "date" }),
        to: formatISO(endOfDay(addDays(today, 30)), {
          representation: "date",
        }),
      };
    case "overdue":
      return {
        dateType: "closing_date",
        to: formatISO(subDays(startOfDay(today), 1), {
          representation: "date",
        }),
      };
    default:
      return {
        dateType: filters.dateType,
        from: filters.from,
        to: filters.to,
      };
  }
}

export async function listTenders(filters: TenderFilters): Promise<{
  rows: WebTenderListRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const supabase = getServerSupabase();
  const page = filters.page;
  const pageSize = filters.pageSize;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const sortCol =
    SORTABLE[filters.sortBy] || resolveTenderSortColumn(filters.sortBy);
  const ascending = filters.sortDir === "asc";
  const dateBounds = applyQuickDate(filters);

  let query = supabase
    .from("agenttender_web_tender_list")
    .select(WEB_TENDER_LIST_SELECT, { count: "exact" });

  if (filters.source && filters.source !== "ALL") {
    query = query.eq("source_portal", filters.source);
  }

  if (filters.status && filters.status !== "ALL") {
    const statusFilter = qualificationStatusesForFilter(filters.status);
    if (statusFilter.kind === "null") {
      query = query.is("effective_qualification_status", null);
    } else if (statusFilter.kind === "in") {
      query = query.in("effective_qualification_status", statusFilter.values);
    }
  }

  if (filters.downloadStatus) {
    query = query.eq("download_status", filters.downloadStatus);
  }

  if (filters.state) query = query.ilike("state", filters.state);
  if (filters.city) query = query.ilike("city", `%${filters.city}%`);
  if (filters.category && isProjectCategory(filters.category)) {
    query = query.eq("project_category", filters.category);
  }
  if (filters.organization) {
    query = query.ilike("organization", `%${filters.organization}%`);
  }
  if (filters.authority) {
    query = query.ilike("authority", `%${filters.authority}%`);
  }

  // Explicit min/max still supported; valueBand shortcuts override when set.
  let tenderValueMin = filters.tenderValueMin;
  let tenderValueMax = filters.tenderValueMax;
  let tenderValueNullOnly = false;
  switch (filters.valueBand) {
    case "LT_10L":
      tenderValueMin = undefined;
      tenderValueMax = 999_999.999;
      break;
    case "L10_1CR":
      tenderValueMin = 1_000_000;
      tenderValueMax = 9_999_999.999;
      break;
    case "CR1_5":
      tenderValueMin = 10_000_000;
      tenderValueMax = 50_000_000;
      break;
    case "GT_5CR":
      tenderValueMin = 50_000_000.001;
      tenderValueMax = undefined;
      break;
    case "NOT_DISCLOSED":
      tenderValueNullOnly = true;
      tenderValueMin = undefined;
      tenderValueMax = undefined;
      break;
    default:
      break;
  }

  if (tenderValueNullOnly) {
    query = query.is("tender_value", null);
  } else {
    if (tenderValueMin != null) {
      query = query.gte("tender_value", tenderValueMin);
    }
    if (tenderValueMax != null) {
      query = query.lte("tender_value", tenderValueMax);
    }
  }

  let emdMin = filters.emdMin;
  let emdMax = filters.emdMax;
  let emdNullOnly = false;
  let emdNotRequired = false;
  switch (filters.emdBand) {
    case "LT_1L":
      emdMin = undefined;
      emdMax = 99_999.999;
      break;
    case "L1_5":
      emdMin = 100_000;
      emdMax = 499_999.999;
      break;
    case "L5_15":
      emdMin = 500_000;
      emdMax = 1_500_000;
      break;
    case "GT_15L":
      emdMin = 1_500_000.001;
      emdMax = undefined;
      break;
    case "NOT_DISCLOSED":
      emdNullOnly = true;
      break;
    case "NOT_REQUIRED":
      emdNotRequired = true;
      break;
    default:
      break;
  }

  if (emdNotRequired) {
    query = query.or(
      [
        "emd_amount.eq.0",
        "emd_text.ilike.%not required%",
        "emd_text.ilike.%nil%",
        "emd_text.ilike.%exempt%",
      ].join(","),
    );
  } else if (emdNullOnly) {
    query = query.is("emd_amount", null);
  } else {
    if (emdMin != null) {
      query = query.gte("emd_amount", emdMin);
    }
    if (emdMax != null) {
      query = query.lte("emd_amount", emdMax);
    }
  }

  if (filters.manualReview === "true") {
    query = query.eq("manual_review_required", true);
  } else if (filters.manualReview === "false") {
    query = query.eq("manual_review_required", false);
  }

  if (filters.qualified === "true") {
    query = query.not("effective_qualification_status", "is", null);
  } else if (filters.qualified === "false") {
    query = query.is("effective_qualification_status", null);
  }

  const dateCol = dateBounds.dateType;
  if (dateBounds.from) {
    query = query.gte(dateCol, dateBounds.from);
  }
  if (dateBounds.to) {
    query = query.lte(dateCol, dateBounds.to);
  }

  const createdRange = resolveCreatedDateRange({
    preset: filters.date,
    selectedDate: filters.selectedDate,
  });
  if (createdRange) {
    query = query.gte("created_at", createdRange.from);
    query = query.lte("created_at", createdRange.to);
  }

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    query = query.or(
      [
        `title.ilike.%${q}%`,
        `source_tender_id.ilike.%${q}%`,
        `folder_id.ilike.%${q}%`,
        `organization.ilike.%${q}%`,
        `authority.ilike.%${q}%`,
        `department.ilike.%${q}%`,
        `city.ilike.%${q}%`,
        `state.ilike.%${q}%`,
        `category.ilike.%${q}%`,
        `project_category.ilike.%${q}%`,
      ].join(","),
    );
  }

  // Sort entire filtered set, then paginate (nulls last for ASC/DESC).
  // Status uses DB lexical order on effective_qualification_status (stable,
  // deterministic). Custom business rank (GO → … → NOT_EVALUATED) would need
  // a generated column / RPC — not applied here to keep queries simple.
  query = query.order(sortCol, { ascending, nullsFirst: false });
  if (sortCol !== "id") {
    query = query.order("id", { ascending: true });
  }
  query = query.range(from, to);

  const result = await query;
  const data = assertSupabaseOk(result, {
    queryName: "listTenders",
    selectedColumns: WEB_TENDER_LIST_SELECT,
    filters: { ...filters, sortCol },
  });

  return {
    rows: (data || []) as unknown as WebTenderListRow[],
    total: result.count ?? 0,
    page,
    pageSize,
  };
}

export async function countVisibleTenders(): Promise<number> {
  const supabase = getServerSupabase();
  const { count, error } = await supabase
    .from("agenttender_web_tender_list")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getTenderById(id: string): Promise<{
  tender: Record<string, unknown>;
  qualification: Record<string, unknown> | null;
} | null> {
  const supabase = getServerSupabase();
  const tender = assertSupabaseOk(
    await supabase.from("agenttender_tenders").select("*").eq("id", id).maybeSingle(),
    { queryName: "getTenderById", selectedColumns: "*", filters: { id } },
  );
  if (!tender) return null;

  const { data: qualification } = await supabase
    .from("agenttender_qualification_results")
    .select("*")
    .eq("tender_id", id)
    .maybeSingle();

  return { tender, qualification: qualification ?? null };
}

export async function getFilterFacets(): Promise<{
  states: string[];
  categories: string[];
  organizations: string[];
}> {
  const supabase = getServerSupabase();
  const data = assertSupabaseOk(
    await supabase
      .from("agenttender_tenders")
      .select("state, project_category, organization")
      .limit(2000),
    {
      queryName: "getFilterFacets",
      selectedColumns: "state, project_category, organization",
    },
  );

  const states = new Set<string>();
  const categories = new Set<string>();
  const organizations = new Set<string>();
  for (const row of data || []) {
    if (row.state) states.add(row.state);
    if (isProjectCategory(row.project_category)) {
      categories.add(row.project_category);
    }
    if (row.organization) organizations.add(row.organization);
  }
  return {
    states: [...states].sort(),
    categories: [...categories].sort().slice(0, 100),
    organizations: [...organizations].sort().slice(0, 100),
  };
}

export type TenderExplorerFacet = {
  value: string;
  label: string;
};

export async function getTenderExplorerFacets(): Promise<{
  categories: TenderExplorerFacet[];
  portals: Array<"TENDER247" | "BIDASSIST">;
}> {
  const supabase = getServerSupabase();
  const data = assertSupabaseOk(
    await supabase
      .from("agenttender_tenders")
      .select("project_category, source_portal")
      .limit(5000),
    {
      queryName: "getTenderExplorerFacets",
      selectedColumns: "project_category, source_portal",
    },
  );

  const portals = new Set<"TENDER247" | "BIDASSIST">();
  const present = new Set<string>();
  for (const row of data || []) {
    if (row.source_portal === "TENDER247" || row.source_portal === "BIDASSIST") {
      portals.add(row.source_portal);
    }
    if (isProjectCategory(row.project_category)) {
      present.add(row.project_category);
    }
  }

  const categories = PROJECT_CATEGORIES.filter((label) => present.has(label)).map(
    (label) => ({ value: label, label }),
  );

  return {
    categories,
    portals: [...portals].sort(),
  };
}

function sanitizeSearchTerm(value: string): string {
  return value.trim().replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Bid Preparation lookup against the existing tender table.
 * Tender ID → source_tender_id (and UUID id).
 * Reference No → folder_id / source_tender_id / title (no dedicated reference column).
 */
export async function searchTendersForBidPreparation(options: {
  tenderId?: string;
  referenceNo?: string;
}): Promise<
  Array<{
    id: string;
    source_tender_id: string;
    folder_id: string | null;
    title: string;
    organization: string | null;
    authority: string | null;
    tender_value: number | null;
    tender_value_text: string | null;
    closing_date: string | null;
    source_portal: string;
    qualification_status: string | null;
    source_url: string | null;
  }>
> {
  const tenderId = sanitizeSearchTerm(options.tenderId || "");
  const referenceNo = sanitizeSearchTerm(options.referenceNo || "");
  if (!tenderId && !referenceNo) return [];

  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_tenders")
    .select(
      "id, source_tender_id, folder_id, title, organization, authority, tender_value, tender_value_text, closing_date, source_portal, qualification_status, source_url",
    )
    .limit(20);

  if (tenderId) {
    const uuidLike =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        tenderId,
      );
    if (uuidLike) {
      query = query.or(
        `id.eq.${tenderId},source_tender_id.ilike.%${tenderId}%`,
      );
    } else {
      query = query.ilike("source_tender_id", `%${tenderId}%`);
    }
  }

  if (referenceNo) {
    query = query.or(
      [
        `folder_id.ilike.%${referenceNo}%`,
        `source_tender_id.ilike.%${referenceNo}%`,
        `title.ilike.%${referenceNo}%`,
      ].join(","),
    );
  }

  const result = await query.order("updated_at", { ascending: false });
  const data = assertSupabaseOk(result, {
    queryName: "searchTendersForBidPreparation",
    selectedColumns:
      "id, source_tender_id, folder_id, title, organization, authority, tender_value, tender_value_text, closing_date, source_portal, qualification_status, source_url",
    filters: { tenderId, referenceNo },
  });

  return (data || []) as Array<{
    id: string;
    source_tender_id: string;
    folder_id: string | null;
    title: string;
    organization: string | null;
    authority: string | null;
    tender_value: number | null;
    tender_value_text: string | null;
    closing_date: string | null;
    source_portal: string;
    qualification_status: string | null;
    source_url: string | null;
  }>;
}
