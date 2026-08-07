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
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileSearch,
  SlidersHorizontal,
} from "lucide-react";

import { StatusBadge } from "@/components/status/qualification-badge";
import type { QualificationStatus } from "@/components/status/qualification-badge";
import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import {
  MoneyCell,
  TruncateWithTooltip,
} from "@/components/tenders/money-cell";
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
import { cn } from "@/lib/utils";
import type { TenderFilters } from "@/lib/validations";
import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

type Facets = {
  states: string[];
  categories: string[];
  organizations: string[];
};

type TenderExplorerProps = {
  rows: WebTenderListRow[];
  total: number;
  filters: TenderFilters;
  facets: Facets;
};

function buildSearchParams(
  current: URLSearchParams,
  updates: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === "" || value === "ALL") {
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

const COL_WIDTH: Record<string, string> = {
  title: "w-[36%]",
  source_portal: "w-[8%]",
  status: "w-[8%]",
  organization: "w-[14%]",
  state: "w-[10%]",
  closing_date: "w-[8%]",
  tender_value: "w-[8%]",
  emd_amount: "w-[8%]",
};

export function TenderExplorer({
  rows,
  total,
  filters,
  facets,
}: TenderExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showFilters, setShowFilters] = React.useState(false);
  const [localQ, setLocalQ] = React.useState(filters.q ?? "");

  const navigate = React.useCallback(
    (updates: Record<string, string | undefined>) => {
      const qs = buildSearchParams(searchParams, updates);
      router.push(`${pathname}${qs}`);
    },
    [pathname, router, searchParams],
  );

  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

  const columns = React.useMemo<LegacyColumnDef<WebTenderListRow>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Title",
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
        header: "Source",
        cell: ({ row }) => (
          <SourceBadge
            source={row.original.source_portal as TenderSource}
            size="sm"
          />
        ),
      },
      {
        id: "status",
        header: "Status",
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
        accessorKey: "organization",
        header: "Organization",
        cell: ({ row }) => (
          <TruncateWithTooltip text={row.original.organization} />
        ),
      },
      {
        accessorKey: "state",
        header: "State",
        cell: ({ row }) => <TruncateWithTooltip text={row.original.state} />,
      },
      {
        accessorKey: "closing_date",
        header: "Closing",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-text-secondary">
            {formatDate(row.original.closing_date)}
          </span>
        ),
      },
      {
        accessorKey: "tender_value",
        header: () => <span className="block w-full text-right">Value</span>,
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
        header: () => <span className="block w-full text-right">EMD</span>,
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
    [],
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
      "Organization",
      "State",
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
        `"${(r.organization || "").replace(/"/g, '""')}"`,
        r.state ?? "",
        r.closing_date ?? "",
        `"${value.replace(/"/g, '""')}"`,
        `"${emd.replace(/"/g, '""')}"`,
        r.source_tender_id,
      ].join(",");
    });
    const blob = new Blob(
      [[headers.join(","), ...csvRows].join("\n")],
      { type: "text/csv;charset=utf-8;" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tenders-page-${filters.page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="rounded-[14px] border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ q: localQ || undefined });
            }}
          >
            <Input
              placeholder="Search tenders, authorities, locations…"
              value={localQ}
              onChange={(e) => setLocalQ(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((v) => !v)}
              className="gap-1.5"
            >
              <SlidersHorizontal className="size-4" />
              Filters
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="gap-1.5"
            >
              <Download className="size-4" />
              Export CSV
            </Button>
          </div>
        </div>

        {showFilters ? (
          <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label="Source"
              value={filters.source}
              options={[
                { value: "ALL", label: "All sources" },
                { value: "TENDER247", label: "Tender247" },
                { value: "BIDASSIST", label: "BidAssist" },
              ]}
              onChange={(v) => navigate({ source: v })}
            />
            <FilterSelect
              label="Status"
              value={filters.status}
              options={[
                { value: "ALL", label: "All statuses" },
                { value: "GO", label: "Go" },
                { value: "CONDITIONAL_GO", label: "Conditional Go" },
                { value: "PARTNER_BID", label: "Partner Bid" },
                { value: "VERIFY", label: "Verify" },
                { value: "NO_GO", label: "No Go" },
                { value: "NOT_EVALUATED", label: "Not evaluated" },
              ]}
              onChange={(v) => navigate({ status: v })}
            />
            <FilterSelect
              label="Quick date"
              value={filters.quickDate ?? ""}
              options={[
                { value: "", label: "Any time" },
                { value: "today", label: "Crawled today" },
                { value: "last_7", label: "Last 7 days" },
                { value: "last_30", label: "Last 30 days" },
                { value: "closing_today", label: "Closing today" },
                { value: "closing_3", label: "Closing in 3 days" },
                { value: "closing_7", label: "Closing in 7 days" },
                { value: "overdue", label: "Overdue" },
              ]}
              onChange={(v) =>
                navigate({ quickDate: v === "__empty" ? undefined : v || undefined })
              }
            />
            <FilterSelect
              label="State"
              value={filters.state ?? ""}
              options={[
                { value: "", label: "All states" },
                ...facets.states.map((s) => ({ value: s, label: s })),
              ]}
              onChange={(v) =>
                navigate({ state: v === "__empty" ? undefined : v || undefined })
              }
            />
            <FilterSelect
              label="Manual review"
              value={filters.manualReview ?? ""}
              options={[
                { value: "", label: "Any" },
                { value: "true", label: "Required" },
                { value: "false", label: "Not required" },
              ]}
              onChange={(v) =>
                navigate({
                  manualReview: v === "__empty" ? undefined : v || undefined,
                })
              }
            />
            <FilterSelect
              label="Sort by"
              value={filters.sortBy}
              options={[
                { value: "updated_at", label: "Updated" },
                { value: "closing_date", label: "Closing date" },
                { value: "tender_value", label: "Value" },
                { value: "emd_amount", label: "EMD" },
                { value: "crawled_at", label: "Crawled" },
                { value: "confidence", label: "Confidence" },
              ]}
              onChange={(v) => navigate({ sortBy: v })}
            />
            <FilterSelect
              label="Sort direction"
              value={filters.sortDir}
              options={[
                { value: "desc", label: "Descending" },
                { value: "asc", label: "Ascending" },
              ]}
              onChange={(v) => navigate({ sortDir: v })}
            />
          </div>
        ) : null}
      </div>

      {/* Results summary */}
      <div className="flex items-center justify-between text-sm text-text-muted">
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

      {/* Empty state */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-border bg-surface py-16 text-center">
          <FileSearch className="mb-4 size-12 text-text-subtle" />
          <h3 className="font-heading text-lg font-semibold text-text-primary">
            No tenders found
          </h3>
          <p className="mt-2 max-w-sm text-sm text-text-muted">
            Try adjusting your filters or search query to find matching tenders.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push("/tenders")}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          {/* Desktop / tablet table — keep VALUE + EMD; scroll horizontally below xl */}
          <div className="hidden overflow-hidden rounded-[14px] border border-border bg-surface shadow-sm md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] table-fixed text-sm xl:min-w-0">
                <thead>
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id} className="border-b border-border bg-surface-muted">
                      {hg.headers.map((header) => {
                        const key = header.column.id;
                        const isMoney =
                          key === "tender_value" || key === "emd_amount";
                        return (
                          <th
                            key={header.id}
                            className={cn(
                              "px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted",
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
                      className="min-h-[64px] border-b border-border last:border-0 hover:bg-surface-muted/50"
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
                  className="block rounded-[14px] border border-border bg-surface p-4 shadow-sm transition-colors hover:bg-surface-muted/50"
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
                      <StatusBadge status={status as QualificationStatus} size="sm" />
                    ) : (
                      <span className="text-xs text-text-muted">Not evaluated</span>
                    )}
                    {row.closing_date ? (
                      <span className="text-xs text-text-muted">
                        Closes {formatDate(row.closing_date)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-text-muted">
                    {row.organization ? (
                      <p className="truncate">
                        <span className="text-text-subtle">Organization · </span>
                        {row.organization}
                      </p>
                    ) : null}
                    {row.state ? (
                      <p className="truncate">
                        <span className="text-text-subtle">State · </span>
                        {row.state}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm text-text-secondary">
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
                  </div>
                  {row.source_url ? (
                    <span className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
                      View source <ExternalLink className="size-3" />
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </>
      )}

      {/* Pagination */}
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
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-text-muted">{label}</label>
      <Select value={value || ""} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value || "__empty"} value={opt.value || "__empty"}>
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
      <Skeleton className="h-20 w-full rounded-[14px]" />
      <Skeleton className="hidden h-[480px] w-full rounded-[14px] md:block" />
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-[14px]" />
        ))}
      </div>
    </div>
  );
}
