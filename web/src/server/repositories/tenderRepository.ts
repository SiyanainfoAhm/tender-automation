import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import { PROJECT_CATEGORIES, isProjectCategory } from "@/lib/project-category";
import { assertSupabaseOk } from "@/lib/errors/db-query";
import {
  resolveClosingDateFilter,
  resolveScrapedDateFilter,
} from "@/lib/tender-date-filter";
import { resolveTenderSortColumn } from "@/lib/tender-sort";
import { qualificationStatusesForFilter, type TenderStatus } from "@/lib/tender-status";
import type { TenderFilters } from "@/lib/validations";
import {
  normalizeTenderCity,
  stripLocationDecorators,
  uniqueNormalizedCities,
} from "@/lib/normalize-tender-city";
import { startOfDay, endOfDay, subDays, addDays, formatISO } from "date-fns";
import { randomUUID } from "crypto";

export type WebTenderListRow = {
  id: string;
  source_portal: "TENDER247" | "BIDASSIST" | "MANUAL";
  source_tender_id: string;
  folder_id: string | null;
  reference_no: string | null;
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
  screening_reason: string | null;
  required_action: string | null;
  confidence: number | null;
  manual_review_required: boolean | null;
  qualified_at: string | null;
  crawled_at: string | null;
  created_at: string;
  scraped_date: string | null;
  first_seen_at: string | null;
  updated_at: string;
  effective_qualification_status: string | null;
  /** Present after duplicate-reference migration is applied. */
  duplicate_of_source_tender_id?: string | null;
  duplicate_of_tender_id?: string | null;
  duplicate_match_kind?: string | null;
  chat_url: string | null;
};

/** Columns needed for the tender table — avoid RFP text, AI JSON, archives. */
export const WEB_TENDER_LIST_SELECT = [
  "id",
  "source_portal",
  "source_tender_id",
  "folder_id",
  "reference_no",
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
  "scraped_date",
  "first_seen_at",
  "crawled_at",
  "updated_at",
  "effective_qualification_status",
  "reason",
  "screening_reason",
  "duplicate_of_source_tender_id",
  "duplicate_of_tender_id",
  "duplicate_match_kind",
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
  scraped_date: "scraped_date",
  scraped: "scraped_date",
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
    const statusKey = String(filters.status).toLowerCase().replace(/[\s-]+/g, "_");
    if (statusKey === "submitted") {
      const submittedIds = await listSubmittedTenderIds();
      if (submittedIds.length === 0) {
        return { rows: [], total: 0, page, pageSize };
      }
      query = query.in("id", submittedIds);
    } else {
      const statusFilter = qualificationStatusesForFilter(filters.status);
      if (statusFilter.kind === "null") {
        query = query.is("effective_qualification_status", null);
      } else if (statusFilter.kind === "in") {
        query = query.in("effective_qualification_status", statusFilter.values);
      }
    }
  }

  if (filters.downloadStatus) {
    query = query.eq("download_status", filters.downloadStatus);
  }

  if (filters.state) query = query.ilike("state", filters.state);
  if (filters.city) {
    const cityFilter = await resolveCityFilterValues(filters.city);
    if (cityFilter.kind === "empty") {
      // Selected city has no matching normalized rows — return empty page.
      query = query.eq("id", "00000000-0000-0000-0000-000000000000");
    } else if (cityFilter.kind === "in") {
      const parts: string[] = [];
      if (cityFilter.cities.length > 0) {
        parts.push(
          `city.in.(${cityFilter.cities.map(quoteOrFilterValue).join(",")})`,
        );
      }
      if (cityFilter.locationTexts.length > 0) {
        parts.push(
          `location_text.in.(${cityFilter.locationTexts.map(quoteOrFilterValue).join(",")})`,
        );
      }
      if (cityFilter.states.length > 0) {
        parts.push(
          `state.in.(${cityFilter.states.map(quoteOrFilterValue).join(",")})`,
        );
      }
      if (parts.length === 1) {
        if (cityFilter.cities.length > 0) {
          query = query.in("city", cityFilter.cities);
        } else if (cityFilter.locationTexts.length > 0) {
          query = query.in("location_text", cityFilter.locationTexts);
        } else {
          query = query.in("state", cityFilter.states);
        }
      } else if (parts.length > 1) {
        query = query.or(parts.join(","));
      }
    }
  }
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

  const scrapedFilter = resolveScrapedDateFilter({
    preset: filters.date,
    selectedDate: filters.selectedDate,
    from: filters.createdFrom,
    to: filters.createdTo,
  });
  if (scrapedFilter?.mode === "eq") {
    query = query.eq("scraped_date", scrapedFilter.value);
  } else if (scrapedFilter?.mode === "range") {
    query = query.gte("scraped_date", scrapedFilter.gte);
    query = query.lte("scraped_date", scrapedFilter.lte);
  }

  const closingFilter = resolveClosingDateFilter({
    preset: filters.closingDate,
    from: filters.closingFrom,
    to: filters.closingTo,
  });
  if (closingFilter?.mode === "eq") {
    query = query.eq("closing_date", closingFilter.value);
  } else if (closingFilter?.mode === "range") {
    query = query.gte("closing_date", closingFilter.gte);
    query = query.lte("closing_date", closingFilter.lte);
  }

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    query = query.or(
      [
        `title.ilike.%${q}%`,
        `source_tender_id.ilike.%${q}%`,
        `reference_no.ilike.%${q}%`,
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
  if (sortCol === "scraped_date") {
    query = query.order("created_at", { ascending: false, nullsFirst: false });
  }
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
  portals: Array<"TENDER247" | "BIDASSIST" | "MANUAL">;
  cities: TenderExplorerFacet[];
}> {
  const supabase = getServerSupabase();
  const data = assertSupabaseOk(
    await supabase
      .from("agenttender_tenders")
      .select("project_category, source_portal, city, state, location_text")
      .limit(5000),
    {
      queryName: "getTenderExplorerFacets",
      selectedColumns: "project_category, source_portal, city, state, location_text",
    },
  );

  const portals = new Set<"TENDER247" | "BIDASSIST" | "MANUAL">();
  const present = new Set<string>();
  const cityCandidates: Array<string | null> = [];
  for (const row of data || []) {
    if (
      row.source_portal === "TENDER247" ||
      row.source_portal === "BIDASSIST" ||
      row.source_portal === "MANUAL"
    ) {
      portals.add(row.source_portal);
    }
    if (isProjectCategory(row.project_category)) {
      present.add(row.project_category);
    }
    cityCandidates.push(
      normalizeTenderCity({
        city: row.city,
        state: row.state,
        location_text: row.location_text,
      }),
    );
  }

  const categories = PROJECT_CATEGORIES.filter((label) => present.has(label)).map(
    (label) => ({ value: label, label }),
  );

  const cities = uniqueNormalizedCities(cityCandidates)
    .slice(0, 80)
    .map((value) => ({ value, label: value }));

  return {
    categories,
    portals: [...portals].sort(),
    cities,
  };
}

function quoteOrFilterValue(value: string): string {
  // PostgREST list value: wrap and escape double quotes.
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Map a user-selected display city to raw DB city/location_text values that
 * normalize to the same city (handles legacy dirty rows without a migration).
 */
async function resolveCityFilterValues(
  selectedCity: string,
): Promise<
  | { kind: "empty" }
  | {
      kind: "in";
      cities: string[];
      locationTexts: string[];
      states: string[];
    }
> {
  const target = normalizeTenderCity(selectedCity);
  if (!target) return { kind: "empty" };

  const supabase = getServerSupabase();
  const data = assertSupabaseOk(
    await supabase
      .from("agenttender_tenders")
      .select("city, state, location_text")
      .limit(5000),
    {
      queryName: "resolveCityFilterValues",
      selectedColumns: "city, state, location_text",
    },
  );

  const cities = new Set<string>();
  const locationTexts = new Set<string>();
  const states = new Set<string>();
  for (const row of data || []) {
    const normalized = normalizeTenderCity({
      city: row.city,
      state: row.state,
      location_text: row.location_text,
    });
    if (!normalized || normalized.toLowerCase() !== target.toLowerCase()) {
      continue;
    }
    const cityRaw = String(row.city || "").trim();
    const locationRaw = String(row.location_text || "").trim();
    const stateRaw = String(row.state || "").trim();
    if (cityRaw) cities.add(cityRaw);
    if (locationRaw) locationTexts.add(locationRaw);
    if (stateRaw && normalizeTenderCity(stateRaw)?.toLowerCase() === target.toLowerCase()) {
      states.add(stateRaw);
    }
    cities.add(target);
  }

  if (cities.size === 0 && locationTexts.size === 0 && states.size === 0) {
    return { kind: "empty" };
  }
  return {
    kind: "in",
    cities: [...cities],
    locationTexts: [...locationTexts],
    states: [...states],
  };
}

async function listSubmittedTenderIds(): Promise<string[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_workspaces")
    .select("tender_id")
    .eq("submission_status", "submitted");
  if (error) {
    console.error("[tenders] submitted filter failed", error.message);
    return [];
  }
  return (data || [])
    .map((row) => String(row.tender_id || ""))
    .filter(Boolean);
}

const ALLOWED_MANUAL_PORTALS = new Set(["MANUAL", "TENDER247", "BIDASSIST"]);

export type CreateManualTenderInput = {
  title: string;
  referenceNo: string;
  portal: "MANUAL" | "TENDER247" | "BIDASSIST";
  portalLink?: string | null;
  category: string;
  tenderType?: string | null;
  organization: string;
  department?: string | null;
  location: string;
  initialStatus?: TenderStatus | null;
  /** Business creation / publication date → `published_date`. */
  creationDate: string;
  deadline: string;
  estimatedValue: number;
  tenderEstCost?: number | null;
  emd?: number | null;
  tenderFee?: number | null;
  processingFee?: number | null;
  finalCost?: number | null;
  msmeExemption?: boolean;
  startupExemption?: boolean;
  exemptionTypes?: string[];
  contacts: Array<{ name: string; mobile: string; email?: string | null }>;
  description: string;
  notes?: string | null;
  noBidReason?: string | null;
};

export async function createManualTender(
  input: CreateManualTenderInput,
): Promise<{ id: string; sourceTenderId: string }> {
  const supabase = getServerSupabase();
  const sourceTenderId = `MAN-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const primaryContact = input.contacts[0] || null;

  const raw_metadata = {
    origin: "manual_entry",
    referenceNo: input.referenceNo,
    tenderEstCost: input.tenderEstCost ?? null,
    tenderFee: input.tenderFee ?? null,
    processingFee: input.processingFee ?? null,
    finalCost: input.finalCost ?? null,
    msmeExemption: Boolean(input.msmeExemption),
    startupExemption: Boolean(input.startupExemption),
    exemptionTypes: input.exemptionTypes || [],
    contacts: input.contacts,
    notes: input.notes || null,
    noBidReason: input.noBidReason || null,
    creationDate: input.creationDate,
  };

  const row = {
    source_portal: ALLOWED_MANUAL_PORTALS.has(input.portal)
      ? input.portal
      : "MANUAL",
    source_tender_id: sourceTenderId,
    folder_id: input.referenceNo,
    reference_no: input.referenceNo,
    title: input.title,
    organization: input.organization,
    department: input.department || null,
    authority: primaryContact?.name || null,
    category: input.category,
    project_category: isProjectCategory(input.category)
      ? input.category
      : "Other",
    tender_type: input.tenderType || null,
    description: input.description,
    city: normalizeTenderCity(input.location) || null,
    location_text: stripLocationDecorators(input.location || "") || input.location || null,
    published_date: input.creationDate,
    closing_date: input.deadline,
    scraped_date: input.creationDate,
    tender_value: input.estimatedValue,
    tender_value_text: `₹${input.estimatedValue.toLocaleString("en-IN")}`,
    emd_amount: input.emd ?? null,
    emd_text:
      input.emd != null ? `₹${input.emd.toLocaleString("en-IN")}` : null,
    source_url: input.portalLink || null,
    download_status: "DISCOVERED",
    qualification_status: input.initialStatus || null,
    raw_metadata,
  };

  const { data, error } = await supabase
    .from("agenttender_tenders")
    .insert(row)
    .select("id, source_tender_id")
    .single();

  if (error) {
    throw new Error(error.message || "Failed to create tender");
  }

  return {
    id: String(data.id),
    sourceTenderId: String(data.source_tender_id),
  };
}

function sanitizeSearchTerm(value: string): string {
  return value.trim().replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Bid Preparation lookup against the existing tender table.
 * Tender ID → source_tender_id (and UUID id).
 * Reference No → reference_no / folder_id / source_tender_id / title.
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
      "id, source_tender_id, folder_id, reference_no, title, organization, authority, tender_value, tender_value_text, closing_date, source_portal, qualification_status, source_url",
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
        `reference_no.ilike.%${referenceNo}%`,
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
      "id, source_tender_id, folder_id, reference_no, title, organization, authority, tender_value, tender_value_text, closing_date, source_portal, qualification_status, source_url",
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
