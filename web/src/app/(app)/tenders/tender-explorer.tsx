"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileSearch,
  Filter,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { AiSummaryDialog, preloadAiSummaryUrl } from "@/components/tenders/ai-summary-dialog";
import type { AiSummaryTenderMeta } from "@/components/tenders/ai-summary-dialog";
import { CategoryCapsule } from "@/components/tenders/category-capsule";
import { TenderLoadingOverlay } from "@/components/tenders/tender-loading-overlay";
import { TenderStatsCards } from "@/components/tenders/tender-stats-cards";
import { TenderExportButtons } from "@/components/tenders/tender-export-buttons";
import { TenderPageActions } from "@/components/tenders/tender-page-actions";
import { TenderListStatusSelect } from "@/components/tenders/tender-list-status-select";
import { TenderAskAiDrawer } from "@/components/tenders/tender-ask-ai-drawer";
import {
  buildTenderSelectedExportFilename,
  downloadTenderExportXlsx,
  exportAllFilteredTenders,
} from "@/lib/tender-export";
import {
  tenderDocumentsDetailHref,
  tenderListAiSummaryUrl,
  tenderListHasAiSummary,
  tenderListHasDocuments,
  tenderListPrescreenReason,
} from "@/lib/tenders/list-row-meta";
import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  isIndianStateName,
  normalizeTenderCity,
  stripLocationDecorators,
} from "@/lib/normalize-tender-city";
import {
  duplicateMatchKindLabel,
  formatDuplicateReference,
} from "@/lib/duplicate-reference";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatInrCompactAmount, formatTenderValue } from "@/lib/format-inr";
import { getDeadlineMeta } from "@/lib/tender-deadline";
import {
  CREATED_DATE_PRESET_LABELS,
  CREATED_DATE_PRESETS,
  formatCompactAppDate,
  type CreatedDatePreset,
} from "@/lib/tender-date-filter";
import {
  createRequestSerial,
  effectiveTenderSearchQuery,
  nextSearchQueryParam,
  tenderSearchHint,
  TENDER_SEARCH_DEBOUNCE_MS,
} from "@/lib/tender-search";
import { tenderStatusCountQueryKey } from "@/lib/tender-status-count-params";
import {
  sortModeId,
  TENDER_SORT_MODES,
} from "@/lib/tender-sort";
import {
  getTenderUiStatus,
  TENDER_LIST_STATUS_FILTERS,
} from "@/lib/tender-status";
import {
  filterKeyWithoutPage,
  getCachedListTotal,
  getCachedTenderList,
  getCachedTenderSummary,
  invalidateTenderListCaches,
  isCacheFresh,
  setCachedListTotal,
  setCachedTenderList,
  setCachedTenderSummary,
  type TenderListCachePayload,
} from "@/lib/tenders/list-cache";
import {
  consumeTendersListScroll,
  rememberTenderDetailOrigin,
  rememberTendersListFilters,
  rememberTendersListReturn,
  tendersListHrefFromParts,
} from "@/lib/tenders/list-return";
import { tenderFiltersSchema, type TenderFilters } from "@/lib/validations";
import { cn } from "@/lib/utils";
import type { TenderListStatusCounts } from "@/server/repositories/analyticsRepository";
import type {
  TenderExplorerFacet,
  WebTenderListRow,
} from "@/server/repositories/tenderRepository";

type TenderListRegion = "INDIAN" | "GLOBAL";

type TenderExplorerProps = {
  cities: TenderExplorerFacet[];
  canImport: boolean;
  canCreate: boolean;
  canEdit: boolean;
  teamMembers: Array<{ id: string; fullName: string }>;
  statusCounts: TenderListStatusCounts | null;
  /** Non-status filter key used when SSR loaded `statusCounts`. */
  statusCountsFilterKey?: string;
  /** Path-locked region (`/tenders/indian` | `/tenders/global`). */
  lockedRegion: TenderListRegion;
};

type ListResponse = {
  rows: WebTenderListRow[];
  total: number;
  page: number;
  pageSize: number;
};

function readFilters(searchParams: URLSearchParams): TenderFilters {
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const parsed = tenderFiltersSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  // URL state can be restored by an old tab or pasted from a prior release.
  // Keep the explorer mountable and let the next filter interaction replace it.
  if (process.env.NODE_ENV === "development") {
    console.warn("[tenders] invalid client list filters; using defaults", {
      invalidFields: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  return tenderFiltersSchema.parse({});
}

function buildSearchParams(
  current: URLSearchParams,
  updates: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(updates)) {
    // `date=all` is intentional (override default scraped-date=today).
    if (key === "date" && value === "all") {
      params.set("date", "all");
      continue;
    }
    // Region is path-locked on Indian/Global list pages — never put ALL in URL.
    if (key === "region") {
      if (value === "INDIAN" || value === "GLOBAL") {
        params.set("region", value);
      } else {
        params.delete(key);
      }
      continue;
    }
    if (
      value === undefined ||
      value === "" ||
      value === "ALL" ||
      value === "__empty" ||
      value === "all"
    ) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  if (!("page" in updates)) {
    params.delete("page");
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function panelFilterCount(filters: TenderFilters): number {
  return [
    filters.source && filters.source !== "ALL",
    filters.status && filters.status !== "ALL",
    Boolean(filters.category?.trim()),
    Boolean(filters.city?.trim()),
    Boolean(filters.date && filters.date !== "all"),
    Boolean(filters.closingDate),
  ].filter(Boolean).length;
}

function hasActiveFilters(filters: TenderFilters): boolean {
  return Boolean(
    filters.q?.trim() ||
      panelFilterCount(filters) > 0 ||
      filters.selectedDate ||
      filters.createdFrom ||
      filters.createdTo ||
      filters.closingFrom ||
      filters.closingTo ||
      filters.quickDate ||
      (filters.closingPreset && filters.closingPreset !== "ALL") ||
      (filters.valueBand && filters.valueBand !== "ALL") ||
      (filters.emdBand && filters.emdBand !== "ALL"),
  );
}

function locationLine(row: WebTenderListRow): string {
  const city = normalizeTenderCity({
    city: row.city,
    state: row.state,
    location_text: row.location_text,
  });
  const state =
    row.state && isIndianStateName(stripLocationDecorators(row.state))
      ? stripLocationDecorators(row.state)
      : null;
  // List subtitle is location only — never ministry / organization / authority.
  return [city, state].filter(Boolean).join(", ");
}

function authorityLine(row: WebTenderListRow): string {
  return String(
    row.organization || row.department || row.authority || "",
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Compact one-line tender title for the list (ellipsis when too long). */
function listTitle(row: WebTenderListRow): string {
  return String(row.title || "").replace(/\s+/g, " ").trim();
}

function moneyLabel(
  amount: number | null | undefined,
  text: string | null | undefined,
  fallbackZero = true,
): string {
  const compact = formatInrCompactAmount(amount ?? null);
  if (compact) return compact;
  if (fallbackZero && (amount == null || !Number.isFinite(Number(amount)))) {
    const fromText = formatTenderValue({ amount, text });
    if (fromText.isNumeric) return fromText.label;
    if (!text?.trim()) return "₹0";
    return fromText.label;
  }
  return formatTenderValue({ amount, text }).label;
}

function normalizeStatusChip(value: string | undefined): string {
  if (!value || value === "ALL") return "ALL";
  const lower = value.toLowerCase().replace(/[\s-]+/g, "_");
  const known = TENDER_LIST_STATUS_FILTERS.some((item) => item.value === lower);
  if (known) return lower;
  return getTenderUiStatus(value);
}

function ListRowSkeleton() {
  return (
    <div className="flex gap-3 border-b border-background-200/70 px-5 py-4">
      <Skeleton className="mt-1 size-4 shrink-0 rounded" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-5 w-3/4 max-w-xl" />
        <Skeleton className="h-3 w-64" />
        <Skeleton className="h-3 w-80" />
        <Skeleton className="h-3 w-52" />
      </div>
      <div className="flex w-28 shrink-0 flex-col items-end gap-2">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="size-8 rounded" />
      </div>
    </div>
  );
}

export function TenderExplorer({
  cities,
  canImport,
  canCreate,
  canEdit,
  teamMembers,
  statusCounts,
  statusCountsFilterKey = "",
  lockedRegion,
}: TenderExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = React.useMemo(() => {
    const parsed = readFilters(searchParams);
    return { ...parsed, region: lockedRegion };
  }, [searchParams, lockedRegion]);
  const queryKey = React.useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("region", lockedRegion);
    return params.toString();
  }, [searchParams, lockedRegion]);
  const listFilterKey = React.useMemo(
    () => filterKeyWithoutPage(queryKey),
    [queryKey],
  );
  const initialListCache = React.useMemo(
    () => getCachedTenderList(queryKey),
    // Only seed from cache for this mount's first queryKey; effect handles later keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount hydrate
    [],
  );

  const [rows, setRows] = React.useState<WebTenderListRow[]>(
    () =>
      (initialListCache?.data.rows as WebTenderListRow[] | undefined) ?? [],
  );
  const [total, setTotal] = React.useState(
    () => initialListCache?.data.total ?? 0,
  );
  const [hasResolvedData, setHasResolvedData] = React.useState(
    () => Boolean(initialListCache),
  );
  const [isInitialLoading, setIsInitialLoading] = React.useState(
    () => !initialListCache,
  );
  const [isTableRefreshing, setIsTableRefreshing] = React.useState(false);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] =
    React.useState(false);
  const [aiSummaryOpen, setAiSummaryOpen] = React.useState(false);
  const [aiSummaryTender, setAiSummaryTender] =
    React.useState<AiSummaryTenderMeta | null>(null);
  const aiSummaryHoverTimer = React.useRef<number | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [isExporting, setIsExporting] = React.useState(false);
  const [refreshToken, setRefreshToken] = React.useState(0);
  const [localQ, setLocalQ] = React.useState(filters.q ?? "");
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const activePanelCount = panelFilterCount(filters);
  const [filtersOpen, setFiltersOpen] = React.useState(activePanelCount > 0);
  const hasResolvedDataRef = React.useRef(Boolean(initialListCache));
  const listRequestSerial = React.useRef(createRequestSerial());
  const statusCountsRequestSerial = React.useRef(createRequestSerial());
  const scrollRestoreDone = React.useRef(false);

  const statusCountQueryKey = React.useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("region", lockedRegion);
    return tenderStatusCountQueryKey(params);
  }, [searchParams, lockedRegion]);

  const skipFirstStatusCountsFetch = React.useRef(
    statusCounts != null && statusCountsFilterKey === statusCountQueryKey,
  );

  const [statusCountsState, setStatusCountsState] =
    React.useState<TenderListStatusCounts | null>(() => {
      if (statusCounts != null && statusCountsFilterKey === statusCountQueryKey) {
        return statusCounts;
      }
      const cached = getCachedTenderSummary<TenderListStatusCounts>(
        statusCountQueryKey,
      );
      return cached?.data ?? statusCounts;
    });

  // Adopt SSR counts only when they match the current non-status filter scope.
  // Prevents a soft-nav RSC refresh from overwriting Today-scoped counts with
  // unrelated props after a status-only URL change (status is excluded from
  // the key, so the key stays stable while RSC still re-renders).
  React.useEffect(() => {
    if (statusCounts == null) return;
    if (statusCountsFilterKey !== statusCountQueryKey) return;
    setStatusCountsState(statusCounts);
    setCachedTenderSummary(statusCountQueryKey, statusCounts);
  }, [statusCounts, statusCountsFilterKey, statusCountQueryKey]);

  React.useEffect(() => {
    const cachedSummary = getCachedTenderSummary<TenderListStatusCounts>(
      statusCountQueryKey,
    );
    if (cachedSummary && isCacheFresh(cachedSummary.fetchedAt)) {
      setStatusCountsState(cachedSummary.data);
      if (skipFirstStatusCountsFetch.current) {
        skipFirstStatusCountsFetch.current = false;
      }
      return;
    }

    if (skipFirstStatusCountsFetch.current) {
      skipFirstStatusCountsFetch.current = false;
      if (statusCounts != null) {
        setCachedTenderSummary(statusCountQueryKey, statusCounts);
      }
      return;
    }

    const controller = new AbortController();
    const requestId = statusCountsRequestSerial.current.next();
    void (async () => {
      try {
        const response = await fetch(
          `/api/tenders/status-counts${statusCountQueryKey ? `?${statusCountQueryKey}` : ""}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as TenderListStatusCounts;
        if (controller.signal.aborted) return;
        if (!statusCountsRequestSerial.current.isLatest(requestId)) return;
        setStatusCountsState(data);
        setCachedTenderSummary(statusCountQueryKey, data);
      } catch {
        /* keep prior counts */
      }
    })();
    return () => controller.abort();
  }, [statusCountQueryKey, refreshToken, statusCounts]);

  React.useEffect(() => {
    setLocalQ(filters.q ?? "");
  }, [filters.q]);

  React.useEffect(() => {
    const controller = new AbortController();
    const requestId = listRequestSerial.current.next();

    const cached = getCachedTenderList(queryKey);
    if (cached) {
      const payload = cached.data as TenderListCachePayload;
      setRows(payload.rows as WebTenderListRow[]);
      setTotal(payload.total);
      hasResolvedDataRef.current = true;
      setHasResolvedData(true);
      setIsInitialLoading(false);
      setListError(null);
      if (isCacheFresh(cached.fetchedAt)) {
        setIsTableRefreshing(false);
        setIsBackgroundRefreshing(false);
        if (process.env.NODE_ENV === "development") {
          console.debug("[TenderQuery] cache-hit", { queryKey });
        }
        return () => {
          controller.abort();
        };
      }
      setIsBackgroundRefreshing(true);
      if (process.env.NODE_ENV === "development") {
        console.debug("[TenderQuery] cache-stale-revalidate", { queryKey });
      }
    } else if (hasResolvedDataRef.current) {
      setIsTableRefreshing(true);
    } else {
      setIsInitialLoading(true);
    }

    setListError(null);

    const cachedTotal = getCachedListTotal(listFilterKey);
    const includeCount =
      filters.page === 1 || cachedTotal === undefined ? true : false;

    void (async () => {
      try {
        const params = new URLSearchParams(queryKey);
        if (!includeCount) params.set("includeCount", "0");
        const qs = params.toString();
        if (process.env.NODE_ENV === "development") {
          console.debug("[TenderQuery] fetch", { qs, includeCount });
        }
        const response = await fetch(`/api/tenders${qs ? `?${qs}` : ""}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Failed to load tenders");
        const data = (await response.json()) as ListResponse;
        if (controller.signal.aborted) return;
        if (!listRequestSerial.current.isLatest(requestId)) return;

        const nextTotal =
          data.total >= 0 ? data.total : (cachedTotal ?? total);
        if (data.total >= 0) {
          setCachedListTotal(listFilterKey, data.total);
        }

        const cachedPayload: TenderListCachePayload = {
          rows: data.rows,
          total: nextTotal,
          page: data.page,
          pageSize: data.pageSize,
        };
        setCachedTenderList(queryKey, cachedPayload);

        setRows(data.rows);
        setTotal(nextTotal);
        hasResolvedDataRef.current = true;
        setHasResolvedData(true);
        setListError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (!listRequestSerial.current.isLatest(requestId)) return;
        const message =
          error instanceof Error ? error.message : "Unable to load tenders.";
        setListError(message);
        if (hasResolvedDataRef.current) {
          toast.error("Unable to update tenders.", {
            action: {
              label: "Retry",
              onClick: () => setRefreshToken((value) => value + 1),
            },
          });
        }
      } finally {
        if (controller.signal.aborted) return;
        if (!listRequestSerial.current.isLatest(requestId)) return;
        setIsInitialLoading(false);
        setIsTableRefreshing(false);
        setIsBackgroundRefreshing(false);
      }
    })();

    return () => {
      controller.abort();
    };
    // total is only used as fallback when count is skipped; omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable filter key + page drive fetches
  }, [queryKey, refreshToken, listFilterKey, filters.page]);

  // Keep list filters in sessionStorage for Bid Workspace / sidebar return.
  React.useEffect(() => {
    const returnParams = new URLSearchParams(searchParams.toString());
    returnParams.delete("region");
    rememberTendersListFilters(
      tendersListHrefFromParts(pathname, returnParams.toString()),
    );
  }, [pathname, searchParams]);

  // Restore scroll after returning from Tender Detail (sessionStorage).
  React.useEffect(() => {
    if (scrollRestoreDone.current) return;
    if (!hasResolvedData) return;
    const y = consumeTendersListScroll();
    if (y == null) {
      scrollRestoreDone.current = true;
      return;
    }
    scrollRestoreDone.current = true;
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: "auto" });
    });
  }, [hasResolvedData, queryKey]);

  const openAiSummary = React.useCallback((row: WebTenderListRow) => {
    if (aiSummaryHoverTimer.current != null) {
      window.clearTimeout(aiSummaryHoverTimer.current);
      aiSummaryHoverTimer.current = null;
    }
    setAiSummaryTender({
      id: row.id,
      title: listTitle(row),
      sourcePortal: row.source_portal,
      sourceTenderId: row.source_tender_id,
      referenceNo: row.reference_no,
      organisationName: row.organization || row.authority,
      closingDate: row.closing_date,
      aiSummaryUrl: tenderListAiSummaryUrl(row),
    });
    setAiSummaryOpen(true);
  }, []);

  const scheduleAiSummaryOpen = React.useCallback(
    (row: WebTenderListRow) => {
      if (aiSummaryHoverTimer.current != null) {
        window.clearTimeout(aiSummaryHoverTimer.current);
      }
      preloadAiSummaryUrl(tenderListAiSummaryUrl(row));
      aiSummaryHoverTimer.current = window.setTimeout(() => {
        aiSummaryHoverTimer.current = null;
        openAiSummary(row);
      }, 300);
    },
    [openAiSummary],
  );

  const cancelAiSummaryOpen = React.useCallback(() => {
    if (aiSummaryHoverTimer.current != null) {
      window.clearTimeout(aiSummaryHoverTimer.current);
      aiSummaryHoverTimer.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => {
      if (aiSummaryHoverTimer.current != null) {
        window.clearTimeout(aiSummaryHoverTimer.current);
      }
    };
  }, []);

  const openTenderDetail = React.useCallback(
    (
      tenderId: string,
      options?: { tab?: "documents"; focus?: "ai-summary" },
    ) => {
      // Persist filters without embedding region= in the visible return URL —
      // path (/tenders/indian|global) is the source of truth for region.
      const returnParams = new URLSearchParams(searchParams.toString());
      returnParams.delete("region");
      const returnHref = tendersListHrefFromParts(
        pathname,
        returnParams.toString(),
      );
      rememberTendersListReturn(returnHref, window.scrollY);
      rememberTenderDetailOrigin(returnHref);
      const params = new URLSearchParams();
      if (options?.tab === "documents") params.set("tab", "documents");
      if (options?.focus === "ai-summary") params.set("focus", "ai-summary");
      const qs = params.toString();
      router.push(qs ? `/tenders/${tenderId}?${qs}` : `/tenders/${tenderId}`);
    },
    [pathname, searchParams, router],
  );

  const prefetchTenderDetail = React.useCallback(
    (tenderId: string) => {
      router.prefetch(`/tenders/${tenderId}`);
      router.prefetch(tenderDocumentsDetailHref(tenderId));
    },
    [router],
  );

  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [
    filters.page,
    filters.pageSize,
    filters.q,
    filters.source,
    filters.status,
    filters.category,
    filters.city,
    filters.sortBy,
    filters.sortDir,
    filters.date,
    filters.selectedDate,
    filters.createdFrom,
    filters.createdTo,
    filters.closingDate,
    filters.closingFrom,
    filters.closingTo,
  ]);

  const navigate = React.useCallback(
    (
      updates: Record<string, string | undefined>,
      options?: { replace?: boolean },
    ) => {
      // Region comes from the route (`/tenders/indian|global`), not the query string.
      const qs = buildSearchParams(searchParams, {
        ...updates,
        region: undefined,
      });
      const nextHref = `${pathname}${qs}`;
      const urlQuery = searchParams.toString();
      const currentHref = `${pathname}${urlQuery ? `?${urlQuery}` : ""}`;
      if (nextHref === currentHref) return;
      if (hasResolvedDataRef.current) {
        setIsTableRefreshing(true);
      }
      if (options?.replace) {
        router.replace(nextHref, { scroll: false });
      } else {
        router.push(nextHref, { scroll: false });
      }
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    const decision = nextSearchQueryParam(localQ, filters.q);
    if (decision.action === "none") return;

    if (decision.action === "clear") {
      navigate({ q: undefined, page: "1" }, { replace: true });
      return;
    }

    const handle = window.setTimeout(() => {
      const latest = nextSearchQueryParam(localQ, filters.q);
      if (latest.action !== "search" || !latest.q) return;
      navigate({ q: latest.q, page: "1" }, { replace: true });
    }, TENDER_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [localQ, filters.q, navigate]);

  const commitSearchNow = React.useCallback(() => {
    const q = effectiveTenderSearchQuery(localQ);
    if (!q) return;
    const current = (filters.q ?? "").trim();
    if (q === current) return;
    navigate({ q, page: "1" }, { replace: true });
  }, [filters.q, localQ, navigate]);

  const searchHint = tenderSearchHint(localQ);
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const activeSortModeId = sortModeId(filters.sortBy, filters.sortDir);
  const filtersActive = hasActiveFilters(filters);
  const pageIds = rows.map((row) => row.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const currentStatus = normalizeStatusChip(filters.status);
  const dateValue = filters.date ?? "all";
  const closingDateValue = filters.closingDate ?? "all";
  const dateTriggerLabel =
    filters.date === "custom" && (filters.createdFrom || filters.createdTo)
      ? [
          filters.createdFrom
            ? formatCompactAppDate(`${filters.createdFrom}T12:00:00+05:30`)
            : "…",
          filters.createdTo
            ? formatCompactAppDate(`${filters.createdTo}T12:00:00+05:30`)
            : "…",
        ].join(" – ")
      : filters.date === "custom" && filters.selectedDate
        ? formatCompactAppDate(`${filters.selectedDate}T12:00:00+05:30`)
        : filters.date && filters.date !== "all"
          ? CREATED_DATE_PRESET_LABELS[filters.date as CreatedDatePreset]
          : "All Dates";
  const closingTriggerLabel =
    filters.closingDate === "custom" &&
    (filters.closingFrom || filters.closingTo)
      ? [
          filters.closingFrom
            ? formatCompactAppDate(`${filters.closingFrom}T12:00:00+05:30`)
            : "…",
          filters.closingTo
            ? formatCompactAppDate(`${filters.closingTo}T12:00:00+05:30`)
            : "…",
        ].join(" – ")
      : filters.closingDate
        ? CREATED_DATE_PRESET_LABELS[filters.closingDate]
        : "All Dates";

  function refreshList() {
    invalidateTenderListCaches("manual-refresh");
    setRefreshToken((value) => value + 1);
    router.refresh();
  }

  const handleExportAll = React.useCallback(async () => {
    if (isExporting || total === 0) return;
    setIsExporting(true);
    try {
      const { exported } = await exportAllFilteredTenders(queryKey);
      toast.success(
        exported === 1
          ? "Exported 1 tender."
          : `Exported ${exported.toLocaleString("en-IN")} tenders.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to export tenders.";
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, queryKey, total]);

  const tableBusy = isTableRefreshing || isExporting;

  const onSortModeChange = React.useCallback(
    (modeId: string) => {
      const mode = TENDER_SORT_MODES.find((item) => item.id === modeId);
      if (!mode) {
        navigate({
          sort: undefined,
          direction: undefined,
          order: undefined,
          sortBy: undefined,
          sortDir: undefined,
          page: "1",
        });
        return;
      }
      navigate({
        sort: mode.sort,
        direction: mode.dir,
        order: undefined,
        sortBy: undefined,
        sortDir: undefined,
        page: "1",
      });
    },
    [navigate],
  );

  function clearFilters() {
    setLocalQ("");
    if (hasResolvedDataRef.current) {
      setIsTableRefreshing(true);
    }
    router.push(pathname, { scroll: false });
  }

  function toggleAllPage(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        pageIds.forEach((id) => next.add(id));
      } else {
        pageIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  }

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const showSkeleton = isInitialLoading && !hasResolvedData;
  const showEmpty =
    !showSkeleton &&
    !isTableRefreshing &&
    !listError &&
    rows.length === 0;

  return (
    <TooltipProvider delayDuration={250}>
    <div className="relative" aria-busy={tableBusy}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="section-title">
              {lockedRegion === "GLOBAL" ? "Global Tenders" : "Indian Tenders"}
            </h1>
            <p className="mt-0.5 text-sm text-foreground-500">
              {lockedRegion === "GLOBAL"
                ? "Import, screen and track global Tender247 tenders"
                : "Import, screen and track Indian tenders from your connected portals"}
            </p>
          </div>
          <TenderPageActions
            canImport={canImport}
            canCreate={canCreate}
            disabled={isExporting}
            onCreated={() => {
              invalidateTenderListCaches("manual-tender-created");
              refreshList();
            }}
          />
        </div>

        {isBackgroundRefreshing ? (
          <p className="text-xs text-foreground-500" aria-live="polite">
            Refreshing tender list…
          </p>
        ) : null}

        {statusCountsState ? (
          <TenderStatsCards
            counts={statusCountsState}
            activeStatus={currentStatus}
            onSelectStatus={(status) => {
              // Keep the active scraped-date filter so the list matches card counts.
              navigate({
                status: status ?? undefined,
                page: "1",
              });
            }}
          />
        ) : null}

        <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-400" />
          <Input
            placeholder="Search by name, tender ID or reference no..."
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitSearchNow();
              }
            }}
            className="h-9 pl-9 text-sm"
            aria-describedby={searchHint ? "tender-search-hint" : undefined}
          />
          {searchHint ? (
            <p
              id="tender-search-hint"
              className="mt-1 text-xs text-foreground-500"
            >
              {searchHint}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          variant="secondary"
          className="h-9 gap-1.5 text-sm"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <Filter className="size-3.5" />
          Filters
          {activePanelCount > 0 ? (
            <span className="rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {activePanelCount}
            </span>
          ) : null}
        </Button>

        {filtersActive ? (
          <Button
            type="button"
            variant="ghost"
            className="h-9 gap-1 text-sm"
            onClick={clearFilters}
          >
            <X className="size-3.5" />
            Clear Filters
          </Button>
        ) : null}
      </div>

      {filtersActive ? (
        <div className="flex flex-wrap items-center gap-2">
          {filters.date && filters.date !== "all" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-background-100 px-2.5 py-1 text-xs text-foreground-700">
              Scraped: {dateTriggerLabel}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background-200 disabled:opacity-50"
                aria-label="Clear created date filter"
                onClick={() =>
                  navigate({
                    date: "all",
                    selectedDate: undefined,
                    createdFrom: undefined,
                    createdTo: undefined,
                    page: "1",
                  })
                }
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
          {filters.closingDate ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-background-100 px-2.5 py-1 text-xs text-foreground-700">
              Closing: {closingTriggerLabel}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background-200 disabled:opacity-50"
                aria-label="Clear closing date filter"
                onClick={() =>
                  navigate({
                    closingDate: undefined,
                    closingFrom: undefined,
                    closingTo: undefined,
                    page: "1",
                  })
                }
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
          {currentStatus !== "ALL" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-background-100 px-2.5 py-1 text-xs text-foreground-700">
              Status:{" "}
              {TENDER_LIST_STATUS_FILTERS.find((item) => item.value === currentStatus)
                ?.label ?? currentStatus}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background-200 disabled:opacity-50"
                aria-label="Clear status filter"
                onClick={() => navigate({ status: undefined, page: "1" })}
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
          {filters.city ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-background-100 px-2.5 py-1 text-xs text-foreground-700">
              City: {filters.city}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background-200 disabled:opacity-50"
                aria-label="Clear city filter"
                onClick={() => navigate({ city: undefined, page: "1" })}
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
          {filters.category ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-background-100 px-2.5 py-1 text-xs text-foreground-700">
              Category: {filters.category}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background-200 disabled:opacity-50"
                aria-label="Clear category filter"
                onClick={() => navigate({ category: undefined, page: "1" })}
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
        </div>
      ) : null}

      {filtersOpen ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
                Status
              </p>
              <Select
                value={currentStatus}
                onValueChange={(value) =>
                  navigate({
                    status: value === "ALL" ? undefined : value,
                    page: "1",
                  })
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  {TENDER_LIST_STATUS_FILTERS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
                City / Location
              </p>
              <Select
                value={filters.city || "ALL"}
                onValueChange={(value) =>
                  navigate({
                    city: value === "ALL" ? undefined : value,
                    page: "1",
                  })
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All cities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Cities</SelectItem>
                  {cities.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
                Scraped Date
              </p>
              <Select
                value={dateValue}
                onValueChange={(value) => {
                  if (value === "all") {
                    navigate({
                      date: "all",
                      selectedDate: undefined,
                      createdFrom: undefined,
                      createdTo: undefined,
                      page: "1",
                    });
                    return;
                  }
                  navigate({
                    date: value,
                    selectedDate: undefined,
                    createdFrom: undefined,
                    createdTo: undefined,
                    page: "1",
                  });
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All Dates" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dates</SelectItem>
                  {CREATED_DATE_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {CREATED_DATE_PRESET_LABELS[preset as CreatedDatePreset]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filters.date === "custom" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    value={filters.createdFrom ?? filters.selectedDate ?? ""}
                    aria-label="Scraped from"
                    onChange={(event) =>
                      navigate({
                        date: "custom",
                        createdFrom: event.target.value || undefined,
                        selectedDate: undefined,
                        page: "1",
                      })
                    }
                    className="h-9 text-sm"
                  />
                  <Input
                    type="date"
                    value={filters.createdTo ?? ""}
                    aria-label="Scraped to"
                    onChange={(event) =>
                      navigate({
                        date: "custom",
                        createdTo: event.target.value || undefined,
                        selectedDate: undefined,
                        page: "1",
                      })
                    }
                    className="h-9 text-sm"
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
                Closing Date
              </p>
              <Select
                value={closingDateValue}
                onValueChange={(value) => {
                  if (value === "all") {
                    navigate({
                      closingDate: undefined,
                      closingFrom: undefined,
                      closingTo: undefined,
                      page: "1",
                    });
                    return;
                  }
                  navigate({
                    closingDate: value,
                    closingFrom: undefined,
                    closingTo: undefined,
                    page: "1",
                  });
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="All Dates" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dates</SelectItem>
                  {CREATED_DATE_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {CREATED_DATE_PRESET_LABELS[preset as CreatedDatePreset]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filters.closingDate === "custom" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    value={filters.closingFrom ?? ""}
                    aria-label="Closing from"
                    onChange={(event) =>
                      navigate({
                        closingDate: "custom",
                        closingFrom: event.target.value || undefined,
                        page: "1",
                      })
                    }
                    className="h-9 text-sm"
                  />
                  <Input
                    type="date"
                    value={filters.closingTo ?? ""}
                    aria-label="Closing to"
                    onChange={(event) =>
                      navigate({
                        closingDate: "custom",
                        closingTo: event.target.value || undefined,
                        page: "1",
                      })
                    }
                    className="h-9 text-sm"
                  />
                </div>
              ) : null}
            </div>
          </div>

        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-foreground-500">
          Showing{" "}
          <span className="font-semibold text-foreground-800">
            {total.toLocaleString("en-IN")}
          </span>{" "}
          of{" "}
          {(statusCountsState?.totalTenders ?? total).toLocaleString("en-IN")}{" "}
          tenders
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={activeSortModeId}
            disabled={tableBusy}
            onValueChange={onSortModeChange}
          >
            <SelectTrigger className="h-8 w-[210px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {TENDER_SORT_MODES.map((mode) => (
                <SelectItem key={mode.id} value={mode.id}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TenderExportButtons
            rows={rows}
            total={total}
            page={filters.page}
            exportingAll={isExporting}
            disabled={isExporting}
            onExportAll={() => void handleExportAll()}
          />
          <Select
            value={String(filters.pageSize)}
            disabled={isExporting}
            onValueChange={(v) => navigate({ pageSize: v, page: "1" })}
          >
            <SelectTrigger className="h-8 w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm shadow-sm">
          <span className="font-medium text-foreground-800">
            {selectedRows.length} tender{selectedRows.length === 1 ? "" : "s"}{" "}
            selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-8 text-sm"
              onClick={() =>
                void downloadTenderExportXlsx(
                  selectedRows,
                  buildTenderSelectedExportFilename(selectedRows.length),
                )
              }
            >
              <Download className="size-3.5" />
              Export
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Clear selection"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {listError && hasResolvedData ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          <span>{listError}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {showEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <FileSearch className="mb-4 size-12 text-foreground-400" />
          <h3 className="font-heading text-lg font-semibold text-foreground-900">
            No tenders found for the selected filters.
          </h3>
          <p className="mt-2 max-w-sm text-sm text-foreground-500">
            Try adjusting your filters or search query to find matching tenders.
          </p>
          {filtersActive ? (
            <Button variant="outline" className="mt-4" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          {isTableRefreshing ? (
            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 border-b border-border bg-card/95 px-3 py-2 text-sm text-foreground-600">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading tenders…
            </div>
          ) : null}
          <div
            className={cn(
              "transition-opacity",
              isTableRefreshing && "opacity-60",
            )}
          >
            <div className="flex items-center gap-3 border-b border-background-200/70 bg-background-50/80 px-5 py-2.5">
              <Checkbox
                checked={allPageSelected}
                onCheckedChange={(value) => toggleAllPage(value === true)}
                aria-label="Select page"
              />
              <span className="text-xs font-medium text-foreground-500">
                Select page
              </span>
            </div>
            {showSkeleton
              ? Array.from({ length: 6 }).map((_, index) => (
                  <ListRowSkeleton key={index} />
                ))
              : rows.map((row) => {
                  const deadline = getDeadlineMeta(row.closing_date);
                  const bidLabel = moneyLabel(
                    row.tender_value,
                    row.tender_value_text,
                  );
                  const emdLabel = moneyLabel(row.emd_amount, row.emd_text);
                  // List filters/cards use the tender-row qualification status,
                  // so render that same source of truth. In particular, a
                  // Duplicate filter can otherwise return a row whose stale
                  // effective value still says Submitted.
                  const status =
                    row.qualification_status ??
                    row.effective_qualification_status;
                  const reference = row.reference_no?.trim() || "";
                  const place = locationLine(row);
                  const authority = authorityLine(row);
                  const portal =
                    row.source_portal === "TENDER247" ||
                    row.source_portal === "BIDASSIST" ||
                    row.source_portal === "MANUAL"
                      ? (row.source_portal as TenderSource)
                      : "MANUAL";
                  const hasDocs = tenderListHasDocuments(row);
                  const hasAi = tenderListHasAiSummary(row);
                  const chatgpt = tenderListPrescreenReason(row);

                  return (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      className="group flex cursor-pointer gap-3 border-b border-background-200/70 px-5 py-4 last:border-0 hover:bg-background-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/30"
                      onMouseEnter={() => prefetchTenderDetail(row.id)}
                      onFocus={() => prefetchTenderDetail(row.id)}
                      onClick={() => openTenderDetail(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openTenderDetail(row.id);
                        }
                      }}
                    >
                      <div
                        className="pt-1"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedIds.has(row.id)}
                          onCheckedChange={(value) =>
                            toggleRow(row.id, value === true)
                          }
                          aria-label={`Select ${row.title}`}
                        />
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <h3
                          className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground-900 group-hover:text-primary-700"
                          title={listTitle(row)}
                        >
                          {listTitle(row)}
                        </h3>

                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-500">
                          <SourceBadge
                            source={portal}
                            size="sm"
                            className="rounded px-1.5 py-0.5 normal-case tracking-normal"
                          />
                          <span className="min-w-0 truncate">
                            ID: {row.source_tender_id}
                          </span>
                          {reference && reference !== row.source_tender_id ? (
                            <span className="min-w-0 truncate">
                              Ref: {reference}
                            </span>
                          ) : null}
                          <span className="text-foreground-300" aria-hidden>
                            ·
                          </span>
                          <CategoryCapsule
                            category={row.project_category}
                            title={row.title}
                            sourceCategory={row.category}
                          />
                        </div>

                        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-foreground-700">
                          <span>
                            <span className="text-foreground-500">
                              Bid Value:
                            </span>{" "}
                            <span className="font-semibold text-foreground-900">
                              {bidLabel}
                            </span>
                          </span>
                          <span className="text-foreground-300" aria-hidden>
                            |
                          </span>
                          <span>
                            <span className="text-foreground-500">EMD:</span>{" "}
                            <span className="font-medium">{emdLabel}</span>
                          </span>
                          <span className="text-foreground-300" aria-hidden>
                            |
                          </span>
                          <span>
                            <span className="text-foreground-500">
                              Deadline:
                            </span>{" "}
                            <span className="font-medium">
                              {deadline.dateLabel}
                            </span>
                            {deadline.relativeLabel ? (
                              <>
                                <span className="text-foreground-400">
                                  {" "}
                                  ·{" "}
                                </span>
                                <span className={deadline.relativeClassName}>
                                  {deadline.relativeLabel}
                                </span>
                              </>
                            ) : null}
                          </span>
                        </p>

                        {(authority || place) && (
                          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-500">
                            {authority ? (
                              <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                                <Building2
                                  className="size-3.5 shrink-0 text-foreground-400"
                                  aria-hidden
                                />
                                <span className="truncate">{authority}</span>
                              </span>
                            ) : null}
                            {place ? (
                              <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                                <MapPin
                                  className="size-3.5 shrink-0 text-foreground-400"
                                  aria-hidden
                                />
                                <span className="truncate">{place}</span>
                              </span>
                            ) : null}
                          </div>
                        )}

                        {(chatgpt || hasDocs || hasAi) && (
                          <div
                            className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-snug text-foreground-500"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {chatgpt ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p className="min-w-0 max-w-full truncate sm:max-w-[28rem]">
                                    <span className="font-medium text-foreground-600">
                                      ChatGPT:
                                    </span>{" "}
                                    <span>{chatgpt}</span>
                                  </p>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm text-xs leading-relaxed">
                                  {chatgpt}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                            {chatgpt && (hasDocs || hasAi) ? (
                              <span className="text-foreground-300" aria-hidden>
                                |
                              </span>
                            ) : null}
                            {hasDocs ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="shrink-0 font-medium text-sky-700 hover:underline"
                                    aria-label={`View tender documents for ${listTitle(row)}`}
                                    onClick={() =>
                                      openTenderDetail(row.id, {
                                        tab: "documents",
                                      })
                                    }
                                  >
                                    Tender Documents
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  View official tender/RFP documents
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                            {hasDocs && hasAi ? (
                              <span className="text-foreground-300" aria-hidden>
                                |
                              </span>
                            ) : null}
                            {hasAi ? (
                              <button
                                type="button"
                                className={cn(
                                  "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-emerald-700",
                                  "hover:bg-emerald-50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30",
                                )}
                                aria-label={`View AI summary for ${listTitle(row)}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAiSummary(row);
                                }}
                                onMouseEnter={() => scheduleAiSummaryOpen(row)}
                                onMouseLeave={cancelAiSummaryOpen}
                                onFocus={() =>
                                  preloadAiSummaryUrl(tenderListAiSummaryUrl(row))
                                }
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    openAiSummary(row);
                                  }
                                }}
                              >
                                <Sparkles
                                  className="size-3.5 shrink-0"
                                  aria-hidden
                                />
                                AI Summary
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>

                      <div
                        className="flex w-[7.5rem] shrink-0 flex-col items-end gap-2 sm:w-32"
                        onClick={(event) => event.stopPropagation()}
                        // The row itself is keyboard-clickable. Keep keyboard input in
                        // the status picker/comment dialog from reaching that row (a
                        // space in the required comment previously opened the tender).
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {status ? (
                          <div className="flex w-full flex-col items-end gap-1">
                            <TenderListStatusSelect
                              tenderId={row.id}
                              tenderTitle={listTitle(row)}
                              tenderValue={row.tender_value}
                              currentStatus={status}
                              canEdit={canEdit}
                              teamMembers={teamMembers}
                            />
                            {status === "DUPLICATE"
                              ? (() => {
                                  const ref = formatDuplicateReference({
                                    duplicateOfSourceTenderId:
                                      row.duplicate_of_source_tender_id,
                                    duplicateOfTenderId:
                                      row.duplicate_of_tender_id,
                                    duplicateMatchKind:
                                      row.duplicate_match_kind,
                                    screeningReason:
                                      row.screening_reason || row.reason,
                                    sourcePortal: row.source_portal,
                                  });
                                  if (!ref) return null;
                                  return (
                                    <p className="w-full truncate text-right text-[10px] text-foreground-500">
                                      {duplicateMatchKindLabel(ref.matchKind) ? (
                                        <span>
                                          {duplicateMatchKindLabel(ref.matchKind)}
                                          {": "}
                                        </span>
                                      ) : null}
                                      {ref.href ? (
                                        <Link
                                          href={ref.href}
                                          className="font-medium text-sky-700 hover:underline"
                                          onClick={(event) =>
                                            event.stopPropagation()
                                          }
                                        >
                                          {ref.label}
                                        </Link>
                                      ) : (
                                        <span>{ref.label}</span>
                                      )}
                                    </p>
                                  );
                                })()
                              : null}
                          </div>
                        ) : (
                          <TenderListStatusSelect
                            tenderId={row.id}
                            tenderTitle={listTitle(row)}
                            tenderValue={row.tender_value}
                            currentStatus={null}
                            canEdit={canEdit}
                            teamMembers={teamMembers}
                          />
                        )}
                        <TenderAskAiDrawer
                          tenderId={row.id}
                          tenderTitle={listTitle(row)}
                          compact
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`View ${row.title}`}
                          onClick={() => openTenderDetail(row.id)}
                        >
                          <Eye className="size-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-foreground-500">
            Page {filters.page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page <= 1}
              onClick={() =>
                navigate({ page: String(Math.max(1, filters.page - 1)) })
              }
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page >= totalPages}
              onClick={() =>
                navigate({
                  page: String(Math.min(totalPages, filters.page + 1)),
                })
              }
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
        </div>
      </div>
      {isExporting ? (
        <TenderLoadingOverlay
          title="Exporting tenders"
          description={`Preparing ${total.toLocaleString("en-IN")} matching tenders for download…`}
        />
      ) : null}
      <AiSummaryDialog
        open={aiSummaryOpen}
        onOpenChange={(open) => {
          setAiSummaryOpen(open);
          if (!open) setAiSummaryTender(null);
        }}
        tender={aiSummaryTender}
      />
    </div>
    </TooltipProvider>
  );
}

export function TenderExplorerSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-full max-w-xl rounded-md" />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-background-200/70 bg-background-50 px-4 py-3">
          <Skeleton className="h-4 w-40" />
        </div>
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="flex gap-4 border-b border-background-200/70 px-4 py-3 last:border-0"
          >
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
