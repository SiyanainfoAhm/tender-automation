"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSearch,
  Filter,
  MapPin,
  Search,
  X,
} from "lucide-react";

import { CategoryCapsule } from "@/components/tenders/category-capsule";
import { MatchScore } from "@/components/tenders/match-score";
import { exportTenderRowsCsv } from "@/components/tenders/tender-page-actions";
import type { QualificationStatus } from "@/components/status/qualification-badge";
import { StatusBadge } from "@/components/status/qualification-badge";
import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
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
  nextSortState,
  normalizeSortKeyForUi,
  type TableSortKey,
} from "@/lib/tender-sort";
import { STATUS_DISPLAY_LABELS, TENDER_STATUSES } from "@/lib/tender-status";
import { cn } from "@/lib/utils";
import type { TenderFilters } from "@/lib/validations";
import type {
  TenderExplorerFacet,
  WebTenderListRow,
} from "@/server/repositories/tenderRepository";

type TenderExplorerProps = {
  rows: WebTenderListRow[];
  total: number;
  allCount: number;
  filters: TenderFilters;
  categories: TenderExplorerFacet[];
  portals: Array<"TENDER247" | "BIDASSIST">;
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "All" },
  ...TENDER_STATUSES.map((status) => ({
    value: status,
    label: STATUS_DISPLAY_LABELS[status],
  })),
  { value: "NOT_EVALUATED", label: "Not evaluated" },
];

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
      value === "__empty"
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
  ].filter(Boolean).length;
}

function hasActiveFilters(filters: TenderFilters): boolean {
  return Boolean(
    filters.q?.trim() ||
      panelFilterCount(filters) > 0 ||
      filters.quickDate ||
      (filters.closingPreset && filters.closingPreset !== "ALL") ||
      (filters.valueBand && filters.valueBand !== "ALL") ||
      (filters.emdBand && filters.emdBand !== "ALL"),
  );
}

function locationLine(row: WebTenderListRow): string {
  const location =
    [row.city, row.state].filter(Boolean).join(", ") ||
    row.location_text?.trim() ||
    "";
  const org = row.organization || row.authority || "";
  return [location, org].filter(Boolean).join(" · ");
}

function FilterCapsule({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary-500 text-white"
          : "bg-background-100 text-foreground-600 hover:bg-background-200",
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
  onSort,
}: {
  label: string;
  sortKey: TableSortKey;
  activeKey: TableSortKey | null;
  direction: "asc" | "desc";
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
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        active
          ? "text-primary-600"
          : "text-foreground-500 hover:text-foreground-800",
      )}
    >
      {label}
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

export function TenderExplorer({
  rows,
  total,
  allCount,
  filters,
  categories,
  portals,
}: TenderExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localQ, setLocalQ] = React.useState(filters.q ?? "");
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const activePanelCount = panelFilterCount(filters);
  const [filtersOpen, setFiltersOpen] = React.useState(activePanelCount > 0);

  React.useEffect(() => {
    setLocalQ(filters.q ?? "");
  }, [filters.q]);

  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [filters.page, filters.pageSize, filters.q, filters.source, filters.status, filters.category, filters.sortBy, filters.sortDir]);

  const navigate = React.useCallback(
    (updates: Record<string, string | undefined>) => {
      const qs = buildSearchParams(searchParams, updates);
      router.push(`${pathname}${qs}`);
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = localQ.trim();
      const current = (filters.q ?? "").trim();
      if (next === current) return;
      navigate({ q: next || undefined, page: "1" });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [localQ, filters.q, navigate]);

  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const uiSortKey = normalizeSortKeyForUi(filters.sortBy);
  const filtersActive = hasActiveFilters(filters);
  const pageIds = rows.map((row) => row.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));

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
          sortBy: undefined,
          sortDir: undefined,
          page: "1",
        });
        return;
      }
      navigate({
        sort: next.sortBy,
        direction: next.sortDir,
        sortBy: undefined,
        sortDir: undefined,
        page: "1",
      });
    },
    [filters.sortBy, filters.sortDir, navigate],
  );

  function clearFilters() {
    setLocalQ("");
    router.push(pathname);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-400" />
          <Input
            placeholder="Search by title, reference no. or organization..."
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            className="h-9 pl-9 text-sm"
          />
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
            Clear
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-foreground-500">Sort:</span>
          <SortControl
            label="Deadline"
            sortKey="closing"
            activeKey={uiSortKey}
            direction={filters.sortDir}
            onSort={onSort}
          />
          <SortControl
            label="Match"
            sortKey="match"
            activeKey={uiSortKey}
            direction={filters.sortDir}
            onSort={onSort}
          />
          <SortControl
            label="Value"
            sortKey="value"
            activeKey={uiSortKey}
            direction={filters.sortDir}
            onSort={onSort}
          />
        </div>
      </div>

      {filtersOpen ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
                Status
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map((option) => (
                  <FilterCapsule
                    key={option.value}
                    active={
                      (filters.status || "ALL") === option.value ||
                      (!filters.status && option.value === "ALL")
                    }
                    onClick={() =>
                      navigate({
                        status:
                          option.value === "ALL" ? undefined : option.value,
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
                Category
              </p>
              <div className="flex flex-wrap gap-1.5">
                <FilterCapsule
                  active={!filters.category}
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
                  onClick={() => navigate({ source: undefined, page: "1" })}
                >
                  All
                </FilterCapsule>
                {portals.map((portal) => (
                  <FilterCapsule
                    key={portal}
                    active={filters.source === portal}
                    onClick={() =>
                      navigate({
                        source:
                          portal === "TENDER247" ? "tender247" : "bidassist",
                        page: "1",
                      })
                    }
                  >
                    {portal === "TENDER247" ? "Tender247" : "BidAssist"}
                  </FilterCapsule>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-foreground-500">
          Showing{" "}
          <span className="font-semibold text-foreground-800">
            {total.toLocaleString("en-IN")}
          </span>{" "}
          of {allCount.toLocaleString("en-IN")} tenders
        </p>
        <Select
          value={String(filters.pageSize)}
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
                exportTenderRowsCsv(
                  selectedRows,
                  `tenders-selected-${selectedRows.length}.csv`,
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

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-16 text-center">
          <FileSearch className="mb-4 size-12 text-foreground-400" />
          <h3 className="font-heading text-lg font-semibold text-foreground-900">
            No tenders found
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
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-background-200/70 bg-background-50">
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={(value) =>
                        toggleAllPage(value === true)
                      }
                      aria-label="Select page"
                    />
                  </th>
                  {[
                    "Tender",
                    "Category",
                    "Value / EMD",
                    "Match",
                    "Deadline",
                    "Status",
                  ].map((label) => (
                    <th
                      key={label}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-500"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
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
                  const reference = row.folder_id || row.source_tender_id;
                  const place = locationLine(row);

                  return (
                    <tr
                      key={row.id}
                      className="group cursor-pointer border-b border-background-200/70 last:border-0 hover:bg-background-50"
                      onClick={() => router.push(`/tenders/${row.id}`)}
                    >
                      <td
                        className="px-4 py-3"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedIds.has(row.id)}
                          onCheckedChange={(value) =>
                            toggleRow(row.id, value === true)
                          }
                          aria-label={`Select ${row.title}`}
                        />
                      </td>
                      <td className="max-w-[340px] px-4 py-3">
                        <p className="line-clamp-1 text-sm font-medium text-foreground-800 group-hover:text-primary-600">
                          {row.title}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <SourceBadge
                            source={row.source_portal as TenderSource}
                            size="sm"
                            className="rounded px-1.5 py-0.5 normal-case tracking-normal"
                          />
                          <span className="truncate text-xs text-foreground-500">
                            {reference}
                          </span>
                        </div>
                        {place ? (
                          <p className="mt-0.5 line-clamp-1 flex items-center gap-1 text-xs text-foreground-400">
                            <MapPin className="size-3 shrink-0" aria-hidden />
                            {place}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <CategoryCapsule
                          category={row.project_category}
                          title={row.title}
                          sourceCategory={row.category}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-foreground-800">
                          {value.label}
                        </p>
                        <p className="text-xs text-foreground-400">
                          EMD: {emd.label}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <MatchScore confidence={row.confidence} />
                      </td>
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3">
                        {status ? (
                          <StatusBadge
                            status={status as QualificationStatus}
                            size="sm"
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-background-200 px-2 py-0.5 text-[11px] font-medium text-foreground-600">
                            <span className="size-1.5 rounded-full bg-foreground-400" />
                            Not evaluated
                          </span>
                        )}
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
  );
}

export function TenderExplorerSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-full max-w-xl rounded-md" />
      <Skeleton className="h-[420px] w-full rounded-lg" />
    </div>
  );
}
