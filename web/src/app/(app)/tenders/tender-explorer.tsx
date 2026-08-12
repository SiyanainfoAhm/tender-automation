"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  useLegacyTable,
  type LegacyColumnDef,
} from "@tanstack/react-table/legacy";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSearch,
  X,
} from "lucide-react";

import { StatusBadge } from "@/components/status/qualification-badge";
import type { QualificationStatus } from "@/components/status/qualification-badge";
import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import { MoneyCell } from "@/components/tenders/money-cell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { formatEmdAmount, formatTenderValue } from "@/lib/format-inr";
import {
  nextSortState,
  normalizeSortKeyForUi,
  type TableSortKey,
} from "@/lib/tender-sort";
import { cn } from "@/lib/utils";
import type { TenderFilters } from "@/lib/validations";
import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

type TenderExplorerProps = {
  rows: WebTenderListRow[];
  total: number;
  filters: TenderFilters;
};

const COL_WIDTH: Record<string, string> = {
  title: "w-[50%]",
  source_portal: "w-[9%]",
  status: "w-[11%]",
  closing_date: "w-[10%]",
  tender_value: "w-[10%]",
  emd_amount: "w-[10%]",
};

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

function hasActiveFilters(filters: TenderFilters): boolean {
  return Boolean(
    filters.q?.trim() ||
      (filters.source && filters.source !== "ALL") ||
      (filters.status && filters.status !== "ALL") ||
      filters.quickDate ||
      (filters.closingPreset && filters.closingPreset !== "ALL") ||
      (filters.valueBand && filters.valueBand !== "ALL") ||
      (filters.emdBand && filters.emdBand !== "ALL"),
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  align = "left",
  onSort,
}: {
  label: string;
  sortKey: TableSortKey;
  activeKey: TableSortKey | null;
  direction: "asc" | "desc";
  align?: "left" | "right";
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
        "inline-flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors",
        align === "right" ? "justify-end" : "justify-start",
        active ? "text-primary" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50",
      )}
    >
      {label}
      <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
    </button>
  );
}

export function TenderExplorer({ rows, total, filters }: TenderExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localQ, setLocalQ] = React.useState(filters.q ?? "");

  React.useEffect(() => {
    setLocalQ(filters.q ?? "");
  }, [filters.q]);

  const navigate = React.useCallback(
    (updates: Record<string, string | undefined>) => {
      const qs = buildSearchParams(searchParams, updates);
      router.push(`${pathname}${qs}`);
    },
    [pathname, router, searchParams],
  );

  // Debounced search → URL
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

  const closingPreset =
    filters.closingPreset && filters.closingPreset !== "ALL"
      ? filters.closingPreset
      : filters.quickDate &&
          [
            "closing_today",
            "closing_3",
            "closing_7",
            "closing_30",
            "overdue",
          ].includes(filters.quickDate)
        ? filters.quickDate
        : "ALL";

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

  const columns = React.useMemo<LegacyColumnDef<WebTenderListRow>[]>(
    () => [
      {
        accessorKey: "title",
        header: () => (
          <SortHeader
            label="Title"
            sortKey="title"
            activeKey={uiSortKey}
            direction={filters.sortDir}
            onSort={onSort}
          />
        ),
        cell: ({ row }) => (
          <Link
            href={`/tenders/${row.original.id}`}
            className="font-medium text-text-primary hover:text-primary hover:underline"
          >
            <span className="line-clamp-2 whitespace-normal break-words leading-5">
              {row.original.title}
            </span>
          </Link>
        ),
      },
      {
        accessorKey: "source_portal",
        header: () => (
          <SortHeader
            label="Source"
            sortKey="source"
            activeKey={uiSortKey}
            direction={filters.sortDir}
            onSort={onSort}
          />
        ),
        cell: ({ row }) => (
          <SourceBadge
            source={row.original.source_portal as TenderSource}
            size="sm"
          />
        ),
      },
      {
        id: "status",
        header: () => (
          <SortHeader
            label="Status"
            sortKey="status"
            activeKey={uiSortKey}
            direction={filters.sortDir}
            onSort={onSort}
          />
        ),
        cell: ({ row }) => {
          const status = row.original.effective_qualification_status;
          if (!status) {
            return (
              <span className="text-xs text-text-muted">Not evaluated</span>
            );
          }
          return (
            <StatusBadge status={status as QualificationStatus} size="sm" />
          );
        },
      },
      {
        accessorKey: "closing_date",
        header: () => (
          <SortHeader
            label="Closing"
            sortKey="closing"
            activeKey={uiSortKey}
            direction={filters.sortDir}
            onSort={onSort}
          />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-text-secondary">
            {formatDate(row.original.closing_date)}
          </span>
        ),
      },
      {
        accessorKey: "tender_value",
        header: () => (
          <SortHeader
            label="Value"
            sortKey="value"
            activeKey={uiSortKey}
            direction={filters.sortDir}
            align="right"
            onSort={onSort}
          />
        ),
        cell: ({ row }) => (
          <MoneyCell
            display={formatTenderValue({
              amount: row.original.tender_value,
              text: row.original.tender_value_text,
            })}
          />
        ),
      },
      {
        accessorKey: "emd_amount",
        header: () => (
          <SortHeader
            label="EMD"
            sortKey="emd"
            activeKey={uiSortKey}
            direction={filters.sortDir}
            align="right"
            onSort={onSort}
          />
        ),
        cell: ({ row }) => (
          <MoneyCell
            display={formatEmdAmount({
              amount: row.original.emd_amount,
              text: row.original.emd_text,
            })}
          />
        ),
      },
    ],
    [filters.sortDir, onSort, uiSortKey],
  );

  const table = useLegacyTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  function exportCsv() {
    const headers = [
      "Title",
      "Source",
      "Status",
      "Closing",
      "Value",
      "EMD",
      "Tender ID",
    ];
    const csvRows = rows.map((r) => {
      const value = formatTenderValue({
        amount: r.tender_value,
        text: r.tender_value_text,
      }).label;
      const emd = formatEmdAmount({
        amount: r.emd_amount,
        text: r.emd_text,
      }).label;
      return [
        `"${(r.title || "").replace(/"/g, '""')}"`,
        r.source_portal,
        r.effective_qualification_status ?? "NOT_EVALUATED",
        r.closing_date ?? "",
        `"${value.replace(/"/g, '""')}"`,
        `"${emd.replace(/"/g, '""')}"`,
        r.source_tender_id,
      ].join(",");
    });
    const blob = new Blob([[headers.join(","), ...csvRows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tenders-page-${filters.page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearFilters() {
    setLocalQ("");
    router.push(pathname);
  }

  return (
    <div className="space-y-4">
      {/* Always-visible Tender247-style filter bar */}
      <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search tender title or ID..."
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            className="h-10 min-w-[200px] flex-1 basis-[220px]"
          />

          <FilterSelect
            label="Source"
            active={filters.source !== "ALL"}
            value={filters.source}
            options={[
              { value: "ALL", label: "All sources" },
              { value: "TENDER247", label: "Tender247" },
              { value: "BIDASSIST", label: "BidAssist" },
            ]}
            onChange={(v) =>
              navigate({
                source:
                  v === "ALL"
                    ? undefined
                    : v === "TENDER247"
                      ? "tender247"
                      : "bidassist",
                page: "1",
              })
            }
          />

          <FilterSelect
            label="Status"
            active={filters.status !== "ALL"}
            value={filters.status}
            options={[
              { value: "ALL", label: "All statuses" },
              { value: "GO", label: "GO" },
              { value: "CONDITIONAL_GO", label: "Conditional GO" },
              { value: "PARTNER_BID", label: "Partner Bid" },
              { value: "VERIFY", label: "Verify" },
              { value: "NO_GO", label: "No-Go" },
              { value: "NOT_EVALUATED", label: "Not evaluated" },
            ]}
            onChange={(v) => navigate({ status: v, page: "1" })}
          />

          <FilterSelect
            label="Closing"
            active={closingPreset !== "ALL"}
            value={closingPreset}
            options={[
              { value: "ALL", label: "All closing dates" },
              { value: "closing_today", label: "Today" },
              { value: "closing_3", label: "Next 3 days" },
              { value: "closing_7", label: "Next 7 days" },
              { value: "closing_30", label: "Next 30 days" },
              { value: "overdue", label: "Expired" },
            ]}
            onChange={(v) =>
              navigate({
                closingPreset: v === "ALL" ? undefined : v,
                quickDate: v === "ALL" ? undefined : v,
                page: "1",
              })
            }
          />

          <FilterSelect
            label="Value"
            active={filters.valueBand !== "ALL"}
            value={filters.valueBand ?? "ALL"}
            options={[
              { value: "ALL", label: "All values" },
              { value: "LT_10L", label: "< ₹10 L" },
              { value: "L10_1CR", label: "₹10 L – ₹1 Cr" },
              { value: "CR1_5", label: "₹1 Cr – ₹5 Cr" },
              { value: "GT_5CR", label: "> ₹5 Cr" },
              { value: "NOT_DISCLOSED", label: "Not disclosed" },
            ]}
            onChange={(v) =>
              navigate({
                valueBand: v === "ALL" ? undefined : v,
                page: "1",
              })
            }
          />

          <FilterSelect
            label="EMD"
            active={filters.emdBand !== "ALL"}
            value={filters.emdBand ?? "ALL"}
            options={[
              { value: "ALL", label: "All EMD" },
              { value: "NOT_REQUIRED", label: "No EMD / Not required" },
              { value: "LT_1L", label: "< ₹1 L" },
              { value: "L1_5", label: "₹1 L – ₹5 L" },
              { value: "L5_15", label: "₹5 L – ₹15 L" },
              { value: "GT_15L", label: "> ₹15 L" },
              { value: "NOT_DISCLOSED", label: "Not disclosed" },
            ]}
            onChange={(v) =>
              navigate({
                emdBand: v === "ALL" ? undefined : v,
                page: "1",
              })
            }
          />

          {filtersActive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 gap-1.5"
              onClick={clearFilters}
            >
              <X className="size-3.5" />
              Clear filters
            </Button>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-10 gap-1.5"
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            <Download className="size-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Count + page size */}
      <div className="flex items-center justify-between gap-3 text-sm text-text-muted">
        <span>
          {total.toLocaleString("en-IN")} tender{total !== 1 ? "s" : ""} found
        </span>
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

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center dark:border-slate-700/60 dark:bg-slate-900/70">
          <FileSearch className="mb-4 size-12 text-slate-400 dark:text-slate-500" />
          <h3 className="font-heading text-lg font-semibold text-slate-900 dark:text-slate-50">
            No tenders found
          </h3>
          <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
            Try adjusting your filters or search query to find matching tenders.
          </p>
          {filtersActive ? (
            <Button variant="outline" className="mt-4" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-950/20 md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] table-fixed text-sm xl:min-w-0">
                <thead>
                  {table.getHeaderGroups().map((hg) => (
                    <tr
                      key={hg.id}
                      className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
                    >
                      {hg.headers.map((header) => {
                        const key = header.column.id;
                        const isMoney =
                          key === "tender_value" || key === "emd_amount";
                        return (
                          <th
                            key={header.id}
                            className={cn(
                              "px-3 py-2.5",
                              COL_WIDTH[key] ?? "",
                              isMoney ? "text-right" : "text-left",
                            )}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext(),
                                )}
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-200 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                    >
                      {row.getVisibleCells().map((cell) => {
                        const key = cell.column.id;
                        const isMoney =
                          key === "tender_value" || key === "emd_amount";
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "px-3 py-3 align-middle",
                              isMoney && "text-right",
                            )}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((row) => {
              const status = row.effective_qualification_status;
              const value = formatTenderValue({
                amount: row.tender_value,
                text: row.tender_value_text,
              });
              const emd = formatEmdAmount({
                amount: row.emd_amount,
                text: row.emd_text,
              });
              return (
                <Link
                  key={row.id}
                  href={`/tenders/${row.id}`}
                  className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/70 dark:hover:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 whitespace-normal break-words font-medium leading-5 text-text-primary">
                      {row.title}
                    </h3>
                    <SourceBadge
                      source={row.source_portal as TenderSource}
                      size="sm"
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {status ? (
                      <StatusBadge
                        status={status as QualificationStatus}
                        size="sm"
                      />
                    ) : (
                      <span className="text-xs text-text-muted">
                        Not evaluated
                      </span>
                    )}
                    {row.closing_date ? (
                      <span className="text-xs text-text-muted">
                        Closes {formatDate(row.closing_date)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
                    <span>
                      <span className="text-text-subtle">Value · </span>
                      <span className="font-medium text-text-primary">
                        {value.label}
                      </span>
                    </span>
                    <span>
                      <span className="text-text-subtle">EMD · </span>
                      <span className="font-medium text-text-primary">
                        {emd.label}
                      </span>
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">
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

function FilterSelect({
  label,
  value,
  options,
  onChange,
  active,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  active?: boolean;
}) {
  return (
    <div className="min-w-[140px] flex-1 basis-[140px] sm:flex-none">
      <Select value={value || "ALL"} onValueChange={onChange}>
        <SelectTrigger
          aria-label={label}
          className={cn(
            "h-10 text-sm",
            active &&
              "border-primary/50 bg-primary-muted/40 ring-1 ring-primary/30",
          )}
        >
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function TenderExplorerSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[72px] w-full rounded-xl" />
      <Skeleton className="hidden h-[480px] w-full rounded-xl md:block" />
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
