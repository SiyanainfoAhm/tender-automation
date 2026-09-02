"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileSearch,
  Filter,
  MapPin,
  Search,
  X,
} from "lucide-react";

import { CategoryCapsule } from "@/components/tenders/category-capsule";
import { TenderLoadingOverlay } from "@/components/tenders/tender-loading-overlay";
import { TenderStatsCards } from "@/components/tenders/tender-stats-cards";
import { TenderExportButtons } from "@/components/tenders/tender-export-buttons";
import { TenderPageActions } from "@/components/tenders/tender-page-actions";
import {
  buildTenderSelectedExportFilename,
  downloadTenderExportXlsx,
  exportAllFilteredTenders,
} from "@/lib/tender-export";
import type { QualificationStatus } from "@/components/status/qualification-badge";
import { StatusBadge } from "@/components/status/qualification-badge";
import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
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
import { formatEmdAmount, formatTenderValue } from "@/lib/format-inr";
import { getDeadlineMeta } from "@/lib/tender-deadline";
import {
  CREATED_DATE_PRESET_LABELS,
  CREATED_DATE_PRESETS,
  formatCompactAppDate,
  type CreatedDatePreset,
} from "@/lib/tender-date-filter";
import {
  nextSortState,
  normalizeSortKeyForUi,
  type TableSortKey,
} from "@/lib/tender-sort";
import {
  getTenderUiStatus,
  TENDER_LIST_STATUS_FILTERS,
  TENDER_STATUSES,
} from "@/lib/tender-status";
import { tenderFiltersSchema, type TenderFilters } from "@/lib/validations";
import { cn } from "@/lib/utils";
import type { TenderListStatusCounts } from "@/server/repositories/analyticsRepository";
import type {
  TenderExplorerFacet,
  WebTenderListRow,
} from "@/server/repositories/tenderRepository";

type TenderExplorerProps = {
  allCount: number;
  categories: TenderExplorerFacet[];
  portals: Array<"TENDER247" | "BIDASSIST" | "MANUAL">;
  cities: TenderExplorerFacet[];
  canImport: boolean;
  canCreate: boolean;
  statusCounts: TenderListStatusCounts | null;
};

type ListResponse = {
  rows: WebTenderListRow[];
  total: number;
  page: number;
  pageSize: number;
};

const MIN_OVERLAY_MS = 300;

function overlayCopy(
  updates: Record<string, string | undefined>,
): { title: string; description: string } {
  if (updates.selectedDate) {
    return {
      title: "Loading tenders",
      description: `Fetching tenders for ${formatCompactAppDate(updates.selectedDate)}...`,
    };
  }
  if ("date" in updates) {
    return {
      title: "Loading tenders",
      description: "Fetching selected date...",
    };
  }
  if ("status" in updates) {
    return {
      title: "Updating tenders",
      description: "Applying status filter...",
    };
  }
  if ("category" in updates) {
    return {
      title: "Updating tenders",
      description: "Applying category filter...",
    };
  }
  if ("source" in updates) {
    return {
      title: "Updating tenders",
      description: "Applying portal filter...",
    };
  }
  if ("sort" in updates || "direction" in updates) {
    return {
      title: "Sorting tenders",
      description: "Updating tender order...",
    };
  }
  if ("pageSize" in updates) {
    return {
      title: "Loading tenders",
      description: "Updating page size...",
    };
  }
  if ("page" in updates) {
    return {
      title: "Loading tenders",
      description: "Fetching next page...",
    };
  }
  if ("q" in updates) {
    return {
      title: "Updating tenders",
      description: "Applying search...",
    };
  }
  return {
    title: "Updating tenders",
    description: "Applying filters, please wait...",
  };
}

const listCache = new Map<string, ListResponse>();
const CACHE_LIMIT = 24;

function readFilters(searchParams: URLSearchParams): TenderFilters {
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  return tenderFiltersSchema.parse(raw);
}

function buildSearchParams(
  current: URLSearchParams,
  updates: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(updates)) {
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
    Boolean(filters.date),
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

/** Compact one-line tender title for the list (ellipsis when too long). */
function listTitle(row: WebTenderListRow): string {
  return String(row.title || "").replace(/\s+/g, " ").trim();
}

function normalizeStatusChip(value: string | undefined): string {
  if (!value || value === "ALL") return "ALL";
  const lower = value.toLowerCase().replace(/[\s-]+/g, "_");
  const known = TENDER_LIST_STATUS_FILTERS.some((item) => item.value === lower);
  if (known) return lower;
  return getTenderUiStatus(value);
}

function FilterCapsule({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary-500 text-white"
          : "bg-background-100 text-foreground-600 hover:bg-background-200",
        disabled && "cursor-wait opacity-60",
      )}
    >
      {children}
    </button>
  );
}

function SortControl({
  label,
  sortKey,
  activeKey,
  direction,
  disabled,
  onSort,
}: {
  label: string;
  sortKey: TableSortKey;
  activeKey: TableSortKey | null;
  direction: "asc" | "desc";
  disabled?: boolean;
  onSort: (key: TableSortKey) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = !active
    ? ArrowUpDown
    : direction === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        active
          ? "text-primary-600"
          : "text-foreground-500 hover:text-foreground-800",
        disabled && "cursor-wait opacity-60",
      )}
    >
      {label}
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

function TableRowSkeleton() {
  return (
    <tr className="border-b border-background-200/70">
      <td className="px-4 py-3">
        <Skeleton className="size-4 rounded" />
      </td>
      {Array.from({ length: 8 }).map((_, index) => (
        <td key={index} className="px-4 py-3">
          <Skeleton className="h-4 w-full max-w-[140px]" />
          {index === 0 ? <Skeleton className="mt-2 h-3 w-24" /> : null}
        </td>
      ))}
    </tr>
  );
}

export function TenderExplorer({
  allCount,
  categories,
  portals,
  cities,
  canImport,
  canCreate,
  statusCounts,
}: TenderExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = React.useMemo(
    () => readFilters(searchParams),
    [searchParams],
  );

  const [rows, setRows] = React.useState<WebTenderListRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [hasResolvedData, setHasResolvedData] = React.useState(false);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [overlay, setOverlay] = React.useState({
    title: "Updating tenders",
    description: "Applying filters, please wait...",
  });
  const [exportingAll, setExportingAll] = React.useState(false);
  const [refreshToken, setRefreshToken] = React.useState(0);
  const [localQ, setLocalQ] = React.useState(filters.q ?? "");
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const activePanelCount = panelFilterCount(filters);
  const [filtersOpen, setFiltersOpen] = React.useState(activePanelCount > 0);
  const overlayStartedAt = React.useRef(0);
  const hasResolvedDataRef = React.useRef(false);
  const isUpdatingRef = React.useRef(false);
  isUpdatingRef.current = isUpdating;

  const [statusCountsState, setStatusCountsState] =
    React.useState<TenderListStatusCounts | null>(statusCounts);

  React.useEffect(() => {
    setStatusCountsState(statusCounts);
  }, [statusCounts]);

  const queryKey = searchParams.toString();

  const statusCountQueryKey = React.useMemo(() => {
    const params = new URLSearchParams();
    const date = searchParams.get("date");
    const selectedDate = searchParams.get("selectedDate");
    const createdFrom = searchParams.get("createdFrom");
    const createdTo = searchParams.get("createdTo");
    const source = searchParams.get("source");
    if (date) params.set("date", date);
    if (selectedDate) params.set("selectedDate", selectedDate);
    if (createdFrom) params.set("createdFrom", createdFrom);
    if (createdTo) params.set("createdTo", createdTo);
    if (source && source !== "ALL") params.set("source", source);
    return params.toString();
  }, [searchParams]);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/tenders/status-counts${statusCountQueryKey ? `?${statusCountQueryKey}` : ""}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as TenderListStatusCounts;
        if (!controller.signal.aborted) setStatusCountsState(data);
      } catch {
        /* keep prior counts */
      }
    })();
    return () => controller.abort();
  }, [statusCountQueryKey, refreshToken]);

  React.useEffect(() => {
    setLocalQ(filters.q ?? "");
  }, [filters.q]);

  React.useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const showOverlay = hasResolvedDataRef.current;
    if (showOverlay) {
      setIsUpdating(true);
      overlayStartedAt.current = overlayStartedAt.current || startedAt;
    } else {
      setInitialLoading(true);
    }

    const finish = async () => {
      if (controller.signal.aborted) return;
      if (showOverlay) {
        const elapsed = Date.now() - (overlayStartedAt.current || startedAt);
        const remaining = Math.max(0, MIN_OVERLAY_MS - elapsed);
        if (remaining > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, remaining));
        }
      }
      if (controller.signal.aborted) return;
      setInitialLoading(false);
      setIsUpdating(false);
      overlayStartedAt.current = 0;
    };

    void (async () => {
      try {
        const response = await fetch(
          `/api/tenders${queryKey ? `?${queryKey}` : ""}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("Failed to load tenders");
        const data = (await response.json()) as ListResponse;
        if (controller.signal.aborted) return;
        listCache.set(queryKey, data);
        if (listCache.size > CACHE_LIMIT) {
          const first = listCache.keys().next().value;
          if (typeof first === "string") listCache.delete(first);
        }
        setRows(data.rows);
        setTotal(data.total);
        hasResolvedDataRef.current = true;
        setHasResolvedData(true);
        await finish();
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (hasResolvedDataRef.current) {
          toast.error("Unable to update tenders. Please try again.");
        }
        await finish();
      }
    })();

    return () => {
      controller.abort();
    };
  }, [queryKey, refreshToken]);

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
    (updates: Record<string, string | undefined>) => {
      if (isUpdatingRef.current) return;
      const qs = buildSearchParams(searchParams, updates);
      const nextHref = `${pathname}${qs}`;
      const currentHref = `${pathname}${queryKey ? `?${queryKey}` : ""}`;
      if (nextHref === currentHref) return;
      if (hasResolvedDataRef.current) {
        setOverlay(overlayCopy(updates));
        overlayStartedAt.current = Date.now();
        setIsUpdating(true);
      }
      router.push(nextHref, { scroll: false });
    },
    [pathname, queryKey, router, searchParams],
  );

  React.useEffect(() => {
    if (isUpdating) return;
    const handle = window.setTimeout(() => {
      const next = localQ.trim();
      const current = (filters.q ?? "").trim();
      if (next === current) return;
      navigate({ q: next || undefined, page: "1" });
    }, 350);
    return () => window.clearTimeout(handle);
  }, [localQ, filters.q, navigate, isUpdating]);

  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const uiSortKey = normalizeSortKeyForUi(filters.sortBy);
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
        : filters.date
          ? CREATED_DATE_PRESET_LABELS[filters.date]
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
    listCache.clear();
    setRefreshToken((value) => value + 1);
    router.refresh();
  }

  const handleExportAll = React.useCallback(async () => {
    if (exportingAll || total === 0) return;
    setExportingAll(true);
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
      setExportingAll(false);
    }
  }, [exportingAll, queryKey, total]);

  const tableBusy = isUpdating || exportingAll;

  const onSort = React.useCallback(
    (clicked: TableSortKey) => {
      const next = nextSortState({
        currentSortBy: filters.sortBy,
        currentSortDir: filters.sortDir,
        clicked,
      });
      if ("reset" in next) {
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
        sort: next.sortBy,
        direction: next.sortDir,
        order: undefined,
        sortBy: undefined,
        sortDir: undefined,
        page: "1",
      });
    },
    [filters.sortBy, filters.sortDir, navigate],
  );

  function clearFilters() {
    if (isUpdatingRef.current) return;
    setLocalQ("");
    if (hasResolvedDataRef.current) {
      setOverlay({
        title: "Updating tenders",
        description: "Applying filters, please wait...",
      });
      overlayStartedAt.current = Date.now();
      setIsUpdating(true);
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

  const showSkeleton = initialLoading && !hasResolvedData;
  const showEmpty = !showSkeleton && !isUpdating && rows.length === 0;

  return (
    <div className="relative" aria-busy={tableBusy}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="section-title">Tender Management</h1>
            <p className="mt-0.5 text-sm text-foreground-500">
              Import, screen and track tenders from all your connected portals
            </p>
          </div>
          <TenderPageActions
            canImport={canImport}
            canCreate={canCreate}
            disabled={isUpdating}
            onCreated={refreshList}
          />
        </div>

        {statusCountsState ? (
          <TenderStatsCards
            counts={statusCountsState}
            activeStatus={currentStatus}
            disabled={isUpdating}
            onSelectStatus={(status) =>
              navigate({
                status: status ?? undefined,
                page: "1",
              })
            }
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
            disabled={isUpdating}
            className="h-9 pl-9 text-sm"
          />
        </div>

        <Button
          type="button"
          variant="secondary"
          className="h-9 gap-1.5 text-sm"
          disabled={isUpdating}
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
            disabled={isUpdating}
            onClick={clearFilters}
          >
            <X className="size-3.5" />
            Clear Filters
          </Button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: "closing" as const, label: "Deadline" },
              { key: "value" as const, label: "Value" },
              { key: "created" as const, label: "Created" },
            ] as const
          ).map((item) => (
            <Button
              key={item.key}
              type="button"
              variant={uiSortKey === item.key ? "default" : "secondary"}
              className="h-9 gap-1 text-sm"
              disabled={isUpdating}
              onClick={() => onSort(item.key)}
            >
              {item.label}
              {uiSortKey === item.key ? (
                filters.sortDir === "asc" ? (
                  <ArrowUp className="size-3.5" />
                ) : (
                  <ArrowDown className="size-3.5" />
                )
              ) : (
                <ArrowUpDown className="size-3.5 opacity-50" />
              )}
            </Button>
          ))}
        </div>
      </div>

      {filtersActive ? (
        <div className="flex flex-wrap items-center gap-2">
          {filters.date ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-background-100 px-2.5 py-1 text-xs text-foreground-700">
              Scraped: {dateTriggerLabel}
              <button
                type="button"
                disabled={isUpdating}
                className="rounded-full p-0.5 hover:bg-background-200 disabled:opacity-50"
                aria-label="Clear created date filter"
                onClick={() =>
                  navigate({
                    date: undefined,
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
                disabled={isUpdating}
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
                disabled={isUpdating}
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
                disabled={isUpdating}
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
                disabled={isUpdating}
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
                disabled={isUpdating}
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
                disabled={isUpdating}
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
                disabled={isUpdating}
                onValueChange={(value) => {
                  if (value === "all") {
                    navigate({
                      date: undefined,
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
                    disabled={isUpdating}
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
                    disabled={isUpdating}
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
                disabled={isUpdating}
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
                    disabled={isUpdating}
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
                    disabled={isUpdating}
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

          {(categories.length > 0 || portals.length > 0) ? (
            <div className="grid grid-cols-1 gap-5 border-t border-border pt-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
                  Category
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <FilterCapsule
                    active={!filters.category}
                    disabled={isUpdating}
                    onClick={() =>
                      navigate({ category: undefined, page: "1" })
                    }
                  >
                    All
                  </FilterCapsule>
                  {categories.map((option) => (
                    <FilterCapsule
                      key={option.value}
                      active={filters.category === option.value}
                      disabled={isUpdating}
                      onClick={() =>
                        navigate({
                          category:
                            filters.category === option.value
                              ? undefined
                              : option.value,
                          page: "1",
                        })
                      }
                    >
                      {option.label}
                    </FilterCapsule>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
                  Portal
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <FilterCapsule
                    active={!filters.source || filters.source === "ALL"}
                    disabled={isUpdating}
                    onClick={() => navigate({ source: undefined, page: "1" })}
                  >
                    All
                  </FilterCapsule>
                  {portals.map((portal) => (
                    <FilterCapsule
                      key={portal}
                      active={filters.source === portal}
                      disabled={isUpdating}
                      onClick={() =>
                        navigate({
                          source:
                            portal === "TENDER247"
                              ? "tender247"
                              : portal === "BIDASSIST"
                                ? "bidassist"
                                : "manual",
                          page: "1",
                        })
                      }
                    >
                      {portal === "TENDER247"
                        ? "Tender247"
                        : portal === "BIDASSIST"
                          ? "BidAssist"
                          : "Manual"}
                    </FilterCapsule>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-foreground-500">
          Showing{" "}
          <span className="font-semibold text-foreground-800">
            {total.toLocaleString("en-IN")}
          </span>{" "}
          of {allCount.toLocaleString("en-IN")} tenders
        </p>
        <div className="flex items-center gap-2">
          <TenderExportButtons
            rows={rows}
            total={total}
            page={filters.page}
            exportingAll={exportingAll}
            disabled={tableBusy}
            onExportAll={() => void handleExportAll()}
          />
          <Select
            value={String(filters.pageSize)}
            disabled={tableBusy}
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
              disabled={isUpdating}
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
              disabled={isUpdating}
              aria-label="Clear selection"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="size-4" />
            </Button>
          </div>
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
            <Button variant="outline" className="mt-4" disabled={isUpdating} onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] table-fixed">
              <thead>
                <tr className="border-b border-background-200/70 bg-background-50">
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      checked={allPageSelected}
                      disabled={isUpdating}
                      onCheckedChange={(value) =>
                        toggleAllPage(value === true)
                      }
                      aria-label="Select page"
                    />
                  </th>
                  <th className="w-[30%] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-500">
                    Tender Name
                  </th>
                  <th className="w-[152px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-500">
                    Category
                  </th>
                  <th className="w-[108px] px-4 py-3 text-left">
                    <SortControl
                      label="Est. Value"
                      sortKey="value"
                      activeKey={uiSortKey}
                      direction={filters.sortDir}
                      disabled={isUpdating}
                      onSort={onSort}
                    />
                  </th>
                  <th className="w-[92px] px-4 py-3 text-left">
                    <SortControl
                      label="EMD"
                      sortKey="emd"
                      activeKey={uiSortKey}
                      direction={filters.sortDir}
                      disabled={isUpdating}
                      onSort={onSort}
                    />
                  </th>
                  <th className="w-[118px] px-4 py-3 text-left">
                    <SortControl
                      label="Deadline"
                      sortKey="closing"
                      activeKey={uiSortKey}
                      direction={filters.sortDir}
                      disabled={isUpdating}
                      onSort={onSort}
                    />
                  </th>
                  <th className="w-[124px] px-4 py-3 text-left">
                    <SortControl
                      label="Status"
                      sortKey="status"
                      activeKey={uiSortKey}
                      direction={filters.sortDir}
                      disabled={isUpdating}
                      onSort={onSort}
                    />
                  </th>
                  <th className="w-14 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-500">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {showSkeleton
                  ? Array.from({ length: 8 }).map((_, index) => (
                      <TableRowSkeleton key={index} />
                    ))
                  : rows.map((row) => {
                      const deadline = getDeadlineMeta(row.closing_date);
                      const value = formatTenderValue({
                        amount: row.tender_value,
                        text: row.tender_value_text,
                      });
                      const emd = formatEmdAmount({
                        amount: row.emd_amount,
                        text: row.emd_text,
                      });
                      const status = row.effective_qualification_status;
                      const reference = row.reference_no || "—";
                      const place = locationLine(row);
                      const portal =
                        row.source_portal === "TENDER247" ||
                        row.source_portal === "BIDASSIST" ||
                        row.source_portal === "MANUAL"
                          ? (row.source_portal as TenderSource)
                          : "MANUAL";

                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            "group border-b border-background-200/70 last:border-0 hover:bg-background-50",
                            isUpdating
                              ? "cursor-wait"
                              : "cursor-pointer",
                          )}
                          onClick={() => {
                            if (isUpdating) return;
                            router.push(`/tenders/${row.id}`);
                          }}
                        >
                          <td
                            className="px-4 py-3"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Checkbox
                              checked={selectedIds.has(row.id)}
                              disabled={isUpdating}
                              onCheckedChange={(value) =>
                                toggleRow(row.id, value === true)
                              }
                              aria-label={`Select ${row.title}`}
                            />
                          </td>
                          <td className="max-w-0 px-4 py-3">
                            <p
                              className="truncate text-sm font-medium text-foreground-800 group-hover:text-primary-600"
                              title={listTitle(row)}
                            >
                              {listTitle(row)}
                            </p>
                            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                              <SourceBadge
                                source={portal}
                                size="sm"
                                className="rounded px-1.5 py-0.5 normal-case tracking-normal"
                              />
                              <span className="min-w-0 truncate text-xs text-foreground-500">
                                ID: {row.source_tender_id}
                              </span>
                              {reference && reference !== row.source_tender_id ? (
                                <span className="min-w-0 truncate text-xs text-foreground-500">
                                  Ref: {reference}
                                </span>
                              ) : null}
                            </div>
                            {place ? (
                              <p className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-xs text-foreground-400">
                                <MapPin className="size-3 shrink-0" aria-hidden />
                                <span className="truncate">{place}</span>
                              </p>
                            ) : null}
                          </td>
                          <td className="max-w-0 overflow-hidden px-4 py-3 align-middle">
                            <CategoryCapsule
                              category={row.project_category}
                              title={row.title}
                              sourceCategory={row.category}
                            />
                          </td>
                          <td className="max-w-0 overflow-hidden px-4 py-3 align-middle">
                            <p className="truncate text-sm font-semibold text-foreground-800">
                              {value.label}
                            </p>
                          </td>
                          <td className="max-w-0 overflow-hidden px-4 py-3 align-middle">
                            <p className="truncate text-sm text-foreground-700">
                              {emd.label}
                            </p>
                          </td>
                          <td className="max-w-0 overflow-hidden px-4 py-3 align-middle">
                            <p className="text-sm text-foreground-700">
                              {deadline.dateLabel}
                            </p>
                            {deadline.relativeLabel ? (
                              <p
                                className={cn(
                                  "text-xs",
                                  deadline.relativeClassName,
                                )}
                              >
                                {deadline.relativeLabel}
                              </p>
                            ) : null}
                          </td>
                          <td className="max-w-0 overflow-hidden px-4 py-3 align-middle">
                            {status &&
                            (
                              [
                                "GO",
                                "CONDITIONAL_GO",
                                "PARTNER_BID",
                                "VERIFY",
                                "NO_GO",
                                "DUPLICATE",
                                "WON",
                                "LOST",
                                "DISQUALIFIED",
                                "SUBMITTED",
                              ] as const
                            ).includes(
                              status as (typeof TENDER_STATUSES)[number],
                            ) ? (
                              <div className="space-y-1">
                                <StatusBadge
                                  status={status as QualificationStatus}
                                  size="sm"
                                  className="max-w-full truncate"
                                />
                                {status === "DUPLICATE" ? (
                                  (() => {
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
                                      <p className="truncate text-[10px] text-foreground-500">
                                        {duplicateMatchKindLabel(
                                          ref.matchKind,
                                        ) ? (
                                          <span>
                                            {duplicateMatchKindLabel(
                                              ref.matchKind,
                                            )}
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
                                ) : null}
                              </div>
                            ) : (
                              <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md bg-background-200 px-2 py-0.5 text-[11px] font-medium text-foreground-600">
                                <span className="size-1.5 shrink-0 rounded-full bg-foreground-400" />
                                <span className="truncate">Under Evaluation</span>
                              </span>
                            )}
                          </td>
                          <td
                            className="px-4 py-3"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              disabled={isUpdating}
                              aria-label={`View ${row.title}`}
                              onClick={() => router.push(`/tenders/${row.id}`)}
                            >
                              <Eye className="size-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
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
              disabled={filters.page <= 1 || isUpdating}
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
              disabled={filters.page >= totalPages || isUpdating}
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
      {isUpdating || exportingAll ? (
        <TenderLoadingOverlay
          title={exportingAll ? "Exporting tenders" : overlay.title}
          description={
            exportingAll
              ? `Preparing ${total.toLocaleString("en-IN")} matching tenders for download…`
              : overlay.description
          }
        />
      ) : null}
    </div>
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
