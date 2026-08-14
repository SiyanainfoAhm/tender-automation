import "server-only";

import { addDays, formatISO, startOfDay, subDays } from "date-fns";

import { getServerSupabase } from "@/lib/db/server";
import { assertSupabaseOk } from "@/lib/errors/db-query";
import { formatRelativeTime } from "@/lib/format";
import type {
  ImportHistoryRow,
  ImportPortal,
  ImportPreviewFilters,
  ImportPreviewRow,
  ImportSourceSummary,
} from "@/lib/tender-import";

const SOURCE_COPY: Record<
  ImportPortal,
  { name: string; description: string }
> = {
  TENDER247: {
    name: "Tender247",
    description:
      "Tenders ingested from Tender247 by the TenderFlow crawler pipeline.",
  },
  BIDASSIST: {
    name: "BidAssist",
    description:
      "Tenders ingested from BidAssist by the TenderFlow crawler pipeline.",
  },
};

export async function getImportSourceSummaries(): Promise<ImportSourceSummary[]> {
  const supabase = getServerSupabase();
  const sources: ImportPortal[] = ["TENDER247", "BIDASSIST"];

  return Promise.all(
    sources.map(async (source) => {
      const [countRes, lastRes] = await Promise.all([
        supabase
          .from("agenttender_tenders")
          .select("id", { count: "exact", head: true })
          .eq("source_portal", source),
        supabase
          .from("agenttender_tenders")
          .select("crawled_at")
          .eq("source_portal", source)
          .not("crawled_at", "is", null)
          .order("crawled_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (countRes.error) {
        assertSupabaseOk(countRes, {
          queryName: "importSource.count",
          selectedColumns: "id",
        });
      }
      if (lastRes.error) {
        assertSupabaseOk(lastRes, {
          queryName: "importSource.lastSync",
          selectedColumns: "crawled_at",
        });
      }

      const lastSyncAt = lastRes.data?.crawled_at ?? null;
      const count = countRes.count ?? 0;
      return {
        source,
        name: SOURCE_COPY[source].name,
        description: SOURCE_COPY[source].description,
        connected: count > 0,
        tenderCount: count,
        lastSyncAt,
        lastSyncLabel: lastSyncAt
          ? formatRelativeTime(lastSyncAt)
          : "No crawler sync yet",
      };
    }),
  );
}

export async function getRecentIngestionHistory(
  limit = 8,
): Promise<ImportHistoryRow[]> {
  const supabase = getServerSupabase();
  const since = formatISO(startOfDay(subDays(new Date(), 14)));
  const data = assertSupabaseOk(
    await supabase
      .from("agenttender_tenders")
      .select("source_portal, first_seen_at, last_seen_at")
      .or(`first_seen_at.gte.${since},last_seen_at.gte.${since}`)
      .limit(5000),
    {
      queryName: "importHistory",
      selectedColumns: "source_portal, first_seen_at, last_seen_at",
    },
  );

  const grouped = new Map<
    string,
    { source: ImportPortal; date: string; added: number; duplicates: number }
  >();

  for (const row of data || []) {
    if (row.source_portal !== "TENDER247" && row.source_portal !== "BIDASSIST") {
      continue;
    }
    const firstSeen = row.first_seen_at ? row.first_seen_at.slice(0, 10) : null;
    const lastSeen = row.last_seen_at ? row.last_seen_at.slice(0, 10) : null;

    if (firstSeen && firstSeen >= since.slice(0, 10)) {
      const key = `${row.source_portal}:${firstSeen}`;
      const current = grouped.get(key) ?? {
        source: row.source_portal,
        date: firstSeen,
        added: 0,
        duplicates: 0,
      };
      current.added += 1;
      grouped.set(key, current);
    }

    if (
      lastSeen &&
      lastSeen >= since.slice(0, 10) &&
      firstSeen &&
      lastSeen !== firstSeen
    ) {
      const key = `${row.source_portal}:${lastSeen}`;
      const current = grouped.get(key) ?? {
        source: row.source_portal,
        date: lastSeen,
        added: 0,
        duplicates: 0,
      };
      current.duplicates += 1;
      grouped.set(key, current);
    }
  }

  return [...grouped.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || a.source.localeCompare(b.source))
    .slice(0, limit)
    .map((row) => ({
      id: `${row.source}-${row.date}`,
      source: row.source,
      sourceLabel: SOURCE_COPY[row.source].name,
      date: row.date,
      total: row.added + row.duplicates,
      added: row.added,
      duplicates: row.duplicates,
      status: "Completed" as const,
    }));
}

function sanitizeTerm(value: string): string {
  return value.trim().replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim();
}

export async function previewImportCandidates(
  filters: ImportPreviewFilters,
): Promise<{ rows: ImportPreviewRow[]; total: number }> {
  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_web_tender_list")
    .select(
      "id, title, source_tender_id, folder_id, organization, category, project_category, tender_value, tender_value_text, closing_date, source_portal",
      { count: "exact" },
    )
    .eq("source_portal", filters.source);

  const keywords = filters.keywords ? sanitizeTerm(filters.keywords) : "";
  if (keywords) {
    query = query.or(
      [
        `title.ilike.%${keywords}%`,
        `source_tender_id.ilike.%${keywords}%`,
        `folder_id.ilike.%${keywords}%`,
        `organization.ilike.%${keywords}%`,
        `authority.ilike.%${keywords}%`,
      ].join(","),
    );
  }

  const location = filters.location ? sanitizeTerm(filters.location) : "";
  if (location) {
    query = query.or(
      [
        `city.ilike.%${location}%`,
        `state.ilike.%${location}%`,
        `location_text.ilike.%${location}%`,
      ].join(","),
    );
  }

  if (typeof filters.minValue === "number") {
    query = query.gte("tender_value", filters.minValue);
  }
  if (typeof filters.maxValue === "number") {
    query = query.lte("tender_value", filters.maxValue);
  }
  if (typeof filters.minDaysToDeadline === "number") {
    const from = formatISO(
      addDays(startOfDay(new Date()), Math.max(0, filters.minDaysToDeadline)),
      { representation: "date" },
    );
    query = query.gte("closing_date", from);
  }

  query = query.order("closing_date", { ascending: true, nullsFirst: false }).range(0, 49);

  const result = await query;
  const data = assertSupabaseOk(result, {
    queryName: "previewImportCandidates",
    selectedColumns:
      "id, title, source_tender_id, folder_id, organization, category, project_category, tender_value, closing_date, source_portal",
  });

  const identityKeys = (data || []).map(
    (row) => `${row.source_portal}::${row.source_tender_id}`,
  );
  const existingKeys = new Set<string>();
  if (identityKeys.length > 0) {
    const existing = assertSupabaseOk(
      await supabase
        .from("agenttender_tenders")
        .select("source_portal, source_tender_id")
        .eq("source_portal", filters.source)
        .in(
          "source_tender_id",
          (data || []).map((row) => row.source_tender_id),
        ),
      {
        queryName: "previewImportDuplicates",
        selectedColumns: "source_portal, source_tender_id",
      },
    );
    for (const row of existing || []) {
      existingKeys.add(`${row.source_portal}::${row.source_tender_id}`);
    }
  }

  return {
    rows: (data || []).map((row) => ({
      id: row.id,
      title: row.title,
      sourceTenderId: row.source_tender_id,
      folderId: row.folder_id,
      organization: row.organization,
      category: row.project_category ?? "Other",
      tenderValue: row.tender_value,
      tenderValueText: row.tender_value_text,
      closingDate: row.closing_date,
      sourcePortal: row.source_portal as ImportPortal,
      isDuplicate: existingKeys.has(
        `${row.source_portal}::${row.source_tender_id}`,
      ),
    })),
    total: result.count ?? 0,
  };
}

export async function confirmSelectedTendersInPipeline(ids: string[]): Promise<{
  newAdded: number;
  duplicates: number;
  failed: number;
}> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    200,
  );
  if (uniqueIds.length === 0) {
    return { newAdded: 0, duplicates: 0, failed: 0 };
  }

  const supabase = getServerSupabase();
  const data = assertSupabaseOk(
    await supabase
      .from("agenttender_tenders")
      .select("id, source_portal, source_tender_id")
      .in("id", uniqueIds),
    {
      queryName: "confirmSelectedTendersInPipeline",
      selectedColumns: "id, source_portal, source_tender_id",
    },
  );

  const found = data?.length ?? 0;
  return {
    newAdded: 0,
    duplicates: found,
    failed: uniqueIds.length - found,
  };
}
