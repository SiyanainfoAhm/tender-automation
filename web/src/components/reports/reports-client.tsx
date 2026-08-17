"use client";

import "remixicon/fonts/remixicon.css";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatIndianCurrency } from "@/lib/format";
import { formatWinRate } from "@/lib/reports/funnel";
import type { FinancialYearKey } from "@/lib/reports/financial-year";
import { REPORT_TABS, type ReportTab, type ReportsAnalytics } from "@/lib/reports/types";
import { cn } from "@/lib/utils";

type ReportsClientProps = {
  report: ReportsAnalytics;
  fyOptions: Array<{ key: FinancialYearKey; label: string }>;
  activeTab: ReportTab;
  canExport: boolean;
};

function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(
  filename: string,
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const body = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-5 text-sm font-semibold uppercase tracking-wider text-foreground-900">
      {children}
    </h2>
  );
}

function winRateTone(rate: number | null): string {
  if (rate == null) return "text-foreground-500";
  return rate >= 30 ? "text-emerald-600" : "text-amber-600";
}

function winRateBadge(rate: number | null): string {
  if (rate == null) return "bg-background-100 text-foreground-500";
  return rate >= 30
    ? "bg-emerald-100 text-emerald-700"
    : "bg-amber-100 text-amber-700";
}

export function ReportsClient({
  report,
  fyOptions,
  activeTab,
  canExport,
}: ReportsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const replaceQuery = (next: { fy?: string; tab?: ReportTab }) => {
    const params = new URLSearchParams();
    params.set("fy", next.fy ?? report.financialYear);
    params.set("tab", next.tab ?? activeTab);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const overviewCards = [
    {
      label: "Tenders Bid",
      value: report.summary.tendersBid.toLocaleString("en-IN"),
      icon: "ri-file-list-3-line",
      color: "text-sky-600",
      bg: "bg-sky-50",
    },
    {
      label: "Tenders Won",
      value: report.summary.tendersWon.toLocaleString("en-IN"),
      icon: "ri-trophy-line",
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Win Rate",
      value: formatWinRate(report.summary.winRate),
      icon: "ri-percent-line",
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      label: "Revenue Won",
      value: formatIndianCurrency(report.summary.revenueWon),
      icon: "ri-funds-line",
      color: "text-violet-600",
      bg: "bg-violet-50",
    },
  ];

  const maxMonthlyRevenue = Math.max(
    ...report.monthlyTrend.map((m) => m.revenueWon),
    0,
  );
  const pipelineTotalValue = report.summary.pipelineValue;
  const pipelineTotalCount = report.pipeline.reduce((s, p) => s + p.count, 0);
  const maxClientRevenue = Math.max(
    ...report.clients.map((c) => c.revenue || c.tendersBid),
    1,
  );
  const maxCategoryRevenue = Math.max(
    ...report.categories.map((c) => c.totalRevenue),
    1,
  );
  const maxFunnelCount = Math.max(pipelineTotalCount, 1);

  const donutCategories = useMemo(() => {
    const top = report.categories.slice(0, 5);
    const rest = report.categories.slice(5);
    if (rest.length === 0) return top;
    return [
      ...top,
      {
        category: "Other",
        bid: rest.reduce((s, c) => s + c.bid, 0),
        won: rest.reduce((s, c) => s + c.won, 0),
        lost: rest.reduce((s, c) => s + c.lost, 0),
        winRate: null,
        avgValue: null,
        totalRevenue: rest.reduce((s, c) => s + c.totalRevenue, 0),
        color: "#94a3b8",
      },
    ];
  }, [report.categories]);

  const donutTotal = donutCategories.reduce((s, c) => s + c.bid, 0);
  const donutGradient = useMemo(() => {
    if (donutTotal <= 0) return "#e2e8f0 0deg 360deg";
    let acc = 0;
    return donutCategories
      .map((c) => {
        const start = (acc / donutTotal) * 360;
        acc += c.bid;
        const end = (acc / donutTotal) * 360;
        return `${c.color} ${start}deg ${end}deg`;
      })
      .join(", ");
  }, [donutCategories, donutTotal]);

  const exportCurrentTab = () => {
    const fy = report.financialYear;
    if (activeTab === "overview") {
      downloadCsv(`reports-overview-${fy}.csv`, [
        ["Metric", "Value"],
        ["Tenders Bid", report.summary.tendersBid],
        ["Tenders Won", report.summary.tendersWon],
        ["Win Rate", formatWinRate(report.summary.winRate)],
        ["Revenue Won", report.summary.revenueWon],
        [],
        ["Month", "Bid", "Won", "Revenue"],
        ...report.monthlyTrend.map((m) => [
          m.month,
          m.tendersBid,
          m.tendersWon,
          m.revenueWon,
        ]),
      ]);
      return;
    }
    if (activeTab === "pipeline") {
      downloadCsv(`reports-pipeline-${fy}.csv`, [
        ["Stage", "Count", "Value"],
        ...report.pipeline.map((s) => [s.label, s.count, s.value]),
        [],
        ["Portal", "Total", "Won", "Lost", "Pending", "Win Rate"],
        ...report.portals.map((p) => [
          p.portal,
          p.total,
          p.won,
          p.lost,
          p.pending,
          formatWinRate(p.winRate),
        ]),
      ]);
      return;
    }
    if (activeTab === "financial") {
      downloadCsv(`reports-financial-${fy}.csv`, [
        ["Month", "Revenue", "Profit"],
        ...report.monthlyFinancial.map((m) => [
          m.month,
          m.revenueWon,
          m.profit ?? "",
        ]),
      ]);
      return;
    }
    downloadCsv(`reports-performance-${fy}.csv`, [
      ["Category", "Bid", "Won", "Lost", "Win Rate", "Revenue"],
      ...report.categories.map((c) => [
        c.category,
        c.bid,
        c.won,
        c.lost,
        formatWinRate(c.winRate),
        c.totalRevenue,
      ]),
    ]);
  };

  return (
    <div className={cn("space-y-6", pending && "opacity-80")}>
      <div className="page-header">
        <div>
          <h1 className="section-title">Reports & Analytics</h1>
          <p className="mt-1 text-sm text-foreground-500">
            Comprehensive insights into your bidding performance, pipeline
            health, and financial metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canExport}
            title={
              canExport
                ? "Export current report tab as CSV"
                : "You do not have permission to export reports"
            }
            onClick={exportCurrentTab}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground-700 hover:bg-background-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i className="ri-download-2-line" />
            Export
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground-900"
              >
                <i className="ri-calendar-line" />
                {report.financialYearLabel}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {fyOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt.key}
                  onSelect={() => replaceQuery({ fy: opt.key })}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-background-100 p-1">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => replaceQuery({ tab: tab.key })}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === tab.key
                ? "bg-white text-foreground-900"
                : "text-foreground-500 hover:text-foreground-700",
            )}
          >
            <i className={tab.icon} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <OverviewTab
          report={report}
          overviewCards={overviewCards}
          maxMonthlyRevenue={maxMonthlyRevenue}
          pipelineTotalValue={pipelineTotalValue}
          maxClientRevenue={maxClientRevenue}
          donutCategories={donutCategories}
          donutTotal={donutTotal}
          donutGradient={donutGradient}
        />
      ) : null}
      {activeTab === "pipeline" ? (
        <PipelineTab report={report} maxFunnelCount={maxFunnelCount} />
      ) : null}
      {activeTab === "financial" ? (
        <FinancialTab
          report={report}
          maxMonthlyRevenue={maxMonthlyRevenue}
          maxCategoryRevenue={maxCategoryRevenue}
        />
      ) : null}
      {activeTab === "performance" ? (
        <PerformanceTab report={report} />
      ) : null}
    </div>
  );
}

function OverviewTab(props: {
  report: ReportsAnalytics;
  overviewCards: Array<{
    label: string;
    value: string;
    icon: string;
    color: string;
    bg: string;
  }>;
  maxMonthlyRevenue: number;
  pipelineTotalValue: number;
  maxClientRevenue: number;
  donutCategories: ReportsAnalytics["categories"];
  donutTotal: number;
  donutGradient: string;
}) {
  const {
    report,
    overviewCards,
    maxMonthlyRevenue,
    pipelineTotalValue,
    maxClientRevenue,
    donutCategories,
    donutTotal,
    donutGradient,
  } = props;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {overviewCards.map((item) => (
          <div key={item.label} className="card p-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  item.bg,
                )}
              >
                <i className={cn(item.icon, "text-lg", item.color)} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-foreground-400">{item.label}</p>
                <p className="truncate text-lg font-bold text-foreground-900">
                  {item.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-5 md:p-6">
        <SectionHeading>Win Rate & Revenue Trend (Last 12 Months)</SectionHeading>
        {report.monthlyTrend.every((m) => m.tendersBid === 0 && m.revenueWon === 0) ? (
          <p className="py-8 text-center text-sm text-foreground-500">
            No bid performance data available for this financial year.
          </p>
        ) : (
          <div className="space-y-2">
            {report.monthlyTrend.map((row) => {
              const rate =
                row.tendersBid > 0
                  ? (row.tendersWon / row.tendersBid) * 100
                  : null;
              const width =
                maxMonthlyRevenue > 0
                  ? (row.revenueWon / maxMonthlyRevenue) * 100
                  : 0;
              return (
                <div key={row.monthKey} className="flex items-center gap-3">
                  <span className="w-[72px] shrink-0 text-xs text-foreground-500">
                    {row.month}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="flex h-7 items-center rounded-r-md border-l-2 border-primary-500 bg-primary-500/20 px-2"
                      style={{ width: `${Math.max(width, row.revenueWon > 0 ? 8 : 0)}%` }}
                    >
                      <span className="text-xs font-semibold text-primary-700">
                        {formatIndianCurrency(row.revenueWon)}
                      </span>
                    </div>
                  </div>
                  <span className="w-[72px] shrink-0 text-right text-xs font-semibold text-foreground-700">
                    {row.tendersWon}/{row.tendersBid}
                  </span>
                  <span
                    className={cn(
                      "w-[52px] shrink-0 text-right text-xs font-semibold",
                      winRateTone(rate),
                    )}
                  >
                    {formatWinRate(rate)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5 md:p-6">
          <SectionHeading>Pipeline Value</SectionHeading>
          <p className="text-center text-3xl font-bold text-foreground-900">
            {formatIndianCurrency(pipelineTotalValue)}
          </p>
          <p className="mt-1 text-center text-xs text-foreground-500">
            {report.summary.activeTenders} active tenders ·{" "}
            {report.summary.submittedCount} submitted
          </p>
          <div className="mt-5 space-y-3">
            {report.pipeline
              .filter((s) => s.key !== "new")
              .map((stage) => {
                const width =
                  pipelineTotalValue > 0
                    ? (stage.value / pipelineTotalValue) * 100
                    : 0;
                return (
                  <div key={stage.key}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground-700">
                        {stage.label}
                      </span>
                      <span className="text-foreground-500">
                        {formatIndianCurrency(stage.value)} · {stage.count}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-background-200">
                      <div
                        className={cn("h-full rounded-full", stage.barClass)}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="card p-5 md:p-6">
          <SectionHeading>Top Clients by Revenue</SectionHeading>
          {report.clients.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-500">
              No client revenue in this financial year.
            </p>
          ) : (
            <div className="space-y-3">
              {report.clients.slice(0, 6).map((client, index) => {
                const barValue = client.revenue > 0 ? client.revenue : client.tendersBid;
                const width = (barValue / maxClientRevenue) * 100;
                return (
                  <div key={client.client}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background-100 text-xs font-bold text-foreground-600">
                          {index + 1}
                        </span>
                        <span className="truncate text-sm font-medium text-foreground-900">
                          {client.client}
                        </span>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-foreground-900">
                        {formatIndianCurrency(client.revenue)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background-200">
                      <div
                        className="h-full rounded-full bg-accent-500"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card p-5 md:p-6">
        <SectionHeading>Category Performance</SectionHeading>
        {donutTotal === 0 ? (
          <p className="py-8 text-center text-sm text-foreground-500">
            No category performance data available.
          </p>
        ) : (
          <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[auto_auto_1fr]">
            <div
              className="relative mx-auto h-48 w-48 rounded-full"
              style={{ background: `conic-gradient(${donutGradient})` }}
            >
              <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-white">
                <p className="text-xl font-bold text-foreground-900">{donutTotal}</p>
                <p className="text-[11px] uppercase tracking-wide text-foreground-400">
                  Total Bids
                </p>
              </div>
            </div>
            <div className="hidden lg:block" />
            <div>
              {donutCategories.map((cat) => (
                <div
                  key={cat.category}
                  className="flex items-center justify-between border-b border-background-100 py-1.5 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="truncate text-sm font-medium text-foreground-800">
                      {cat.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-foreground-500">
                      {cat.bid} bids
                    </span>
                    <span className="text-xs text-foreground-500">
                      {cat.won} won
                    </span>
                    <span
                      className={cn(
                        "w-12 text-right text-sm font-semibold",
                        winRateTone(cat.winRate),
                      )}
                    >
                      {formatWinRate(cat.winRate)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineTab({
  report,
  maxFunnelCount,
}: {
  report: ReportsAnalytics;
  maxFunnelCount: number;
}) {
  const ageingTone: Record<
    ReportsAnalytics["ageing"][number]["tone"],
    { bg: string; bar: string; text: string }
  > = {
    rose: { bg: "bg-rose-50", bar: "bg-rose-500", text: "text-rose-700" },
    amber: { bg: "bg-amber-50", bar: "bg-amber-500", text: "text-amber-700" },
    sky: { bg: "bg-sky-50", bar: "bg-sky-500", text: "text-sky-700" },
    emerald: { bg: "bg-emerald-50", bar: "bg-emerald-500", text: "text-emerald-700" },
  };

  return (
    <div className="space-y-6">
      <div className="card p-5 md:p-6">
        <SectionHeading>Pipeline Funnel</SectionHeading>
        <div className="space-y-3">
          {report.pipeline.map((stage) => {
            const width = (stage.count / maxFunnelCount) * 100;
            const share =
              maxFunnelCount > 0
                ? Math.round((stage.count / maxFunnelCount) * 100)
                : 0;
            return (
              <div key={stage.key} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm font-medium text-foreground-700">
                  {stage.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "flex h-8 items-center rounded-md px-3 text-xs font-semibold text-white",
                      stage.barClass,
                    )}
                    style={{ width: `${Math.max(width, stage.count > 0 ? 8 : 0)}%` }}
                  >
                    {stage.count} tenders
                  </div>
                </div>
                <span className="w-12 shrink-0 text-right text-xs font-semibold text-foreground-500">
                  {share}%
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-foreground-400">
          Percentages are share of this FY cohort, not sequential conversion.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {report.pipelineConversions.map((item) => (
          <div key={item.key} className="card p-4 text-center">
            <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-background-100">
              <i className={cn(item.icon, "text-foreground-600")} />
            </div>
            <p className="text-xs text-foreground-500">{item.label}</p>
            <p className="mt-1 text-lg font-bold text-foreground-900">
              {formatWinRate(item.rate)}
            </p>
            <p className="text-[11px] text-foreground-400">
              {item.from} → {item.to}
            </p>
          </div>
        ))}
      </div>

      <div className="card p-5 md:p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground-900">
          Source Portal Performance
        </h2>
        {report.portals.length === 0 ? (
          <p className="py-8 text-center text-sm text-foreground-500">
            No portal bid data for this financial year.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-background-200/60">
                  {["Portal", "Total", "Won", "Lost", "Pending", "Win Rate"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-xs font-semibold uppercase text-foreground-400"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {report.portals.map((portal) => (
                  <tr
                    key={portal.portalKey}
                    className="cursor-pointer border-b border-background-100/60 transition-colors hover:bg-background-50"
                    onClick={() => {
                      window.location.href = `/tenders?source=${encodeURIComponent(portal.portalKey)}`;
                    }}
                  >
                    <td className="px-3 py-3 font-medium text-foreground-900">
                      {portal.portal}
                    </td>
                    <td className="px-3 py-3">{portal.total}</td>
                    <td className="px-3 py-3 text-emerald-600">{portal.won}</td>
                    <td className="px-3 py-3 text-rose-600">{portal.lost}</td>
                    <td className="px-3 py-3 text-foreground-500">
                      {portal.pending}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          winRateBadge(portal.winRate),
                        )}
                      >
                        {formatWinRate(portal.winRate)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {report.ageing.map((bucket) => {
          const tone = ageingTone[bucket.tone];
          return (
            <div key={bucket.key} className="card p-4">
              <p className={cn("text-xs font-semibold uppercase", tone.text)}>
                {bucket.label}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground-900">
                {bucket.count}
              </p>
              <p className="mt-1 text-xs text-foreground-500">
                {bucket.description}
              </p>
              <p className="mt-2 text-xs font-medium text-foreground-500">
                {bucket.percent}%
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background-200">
                <div
                  className={cn("h-full rounded-full", tone.bar)}
                  style={{ width: `${bucket.percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinancialTab({
  report,
  maxMonthlyRevenue,
  maxCategoryRevenue,
}: {
  report: ReportsAnalytics;
  maxMonthlyRevenue: number;
  maxCategoryRevenue: number;
}) {
  const cards = [
    {
      label: "Total Revenue",
      value: formatIndianCurrency(report.summary.revenueWon),
      icon: "ri-funds-line",
      color: "text-primary-600",
      bg: "bg-primary-50",
    },
    {
      label: "Avg Deal Size",
      value:
        report.summary.avgDealSize == null
          ? "—"
          : formatIndianCurrency(report.summary.avgDealSize),
      icon: "ri-scales-3-line",
      color: "text-sky-600",
      bg: "bg-sky-50",
    },
    {
      label: "Pipeline Value",
      value: formatIndianCurrency(report.summary.pipelineValue),
      icon: "ri-bar-chart-2-line",
      color: "text-violet-600",
      bg: "bg-violet-50",
    },
    {
      label: "Profit Margin",
      value:
        report.summary.profitMargin == null
          ? "—"
          : `${report.summary.profitMargin.toFixed(1)}%`,
      icon: "ri-percent-line",
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="card p-5 md:p-6">
        <SectionHeading>Revenue & Profit (Monthly)</SectionHeading>
        {!report.costDataAvailable ? (
          <p className="mb-3 text-xs text-foreground-400">
            Cost data unavailable — profit is not estimated from tender value.
          </p>
        ) : null}
        {report.monthlyFinancial.every((m) => m.revenueWon === 0) ? (
          <p className="py-8 text-center text-sm text-foreground-500">
            No recognized revenue for this financial year.
          </p>
        ) : (
          <div className="space-y-2">
            {report.monthlyFinancial.map((row) => {
              const width =
                maxMonthlyRevenue > 0
                  ? (row.revenueWon / maxMonthlyRevenue) * 100
                  : 0;
              return (
                <div key={row.monthKey} className="flex items-center gap-3">
                  <span className="w-[72px] shrink-0 text-xs text-foreground-500">
                    {row.month}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="flex h-7 items-center rounded-r-md border-l-2 border-primary-500 bg-primary-500/20 px-2"
                      style={{ width: `${Math.max(width, 0)}%` }}
                    >
                      <span className="text-xs font-semibold text-primary-700">
                        {formatIndianCurrency(row.revenueWon)}
                      </span>
                    </div>
                  </div>
                  <span className="w-[88px] shrink-0 text-right text-xs font-semibold text-emerald-600">
                    {row.profit == null
                      ? "—"
                      : `+${formatIndianCurrency(row.profit)}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((item) => (
          <div key={item.label} className="card p-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  item.bg,
                )}
              >
                <i className={cn(item.icon, "text-lg", item.color)} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-foreground-400">{item.label}</p>
                <p className="truncate text-lg font-bold text-foreground-900">
                  {item.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-5 md:p-6">
        <SectionHeading>Revenue by Category</SectionHeading>
        {report.categories.every((c) => c.totalRevenue === 0) ? (
          <p className="py-8 text-center text-sm text-foreground-500">
            No recognized revenue by category for this financial year.
          </p>
        ) : (
          <div className="space-y-3">
            {report.categories.map((cat) => {
              const width = (cat.totalRevenue / maxCategoryRevenue) * 100;
              return (
                <div key={cat.category}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground-800">
                      {cat.category}
                    </span>
                    <span className="text-sm font-semibold text-foreground-900">
                      {formatIndianCurrency(cat.totalRevenue)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-foreground-500">
                    {cat.bid} bids · {cat.won} won at avg{" "}
                    {cat.avgValue == null ? "—" : formatIndianCurrency(cat.avgValue)}
                    <span className="float-right font-semibold">
                      Win Rate {formatWinRate(cat.winRate)}
                    </span>
                  </p>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-background-200">
                    <div
                      className="h-full rounded-full bg-primary-500"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PerformanceTab({ report }: { report: ReportsAnalytics }) {
  return (
    <div className="space-y-6">
      <div className="card p-5 md:p-6">
        <SectionHeading>Win/Loss by Category</SectionHeading>
        {report.categories.length === 0 ? (
          <p className="py-8 text-center text-sm text-foreground-500">
            No category performance data available.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-background-200/60">
                  {[
                    "Category",
                    "Bid",
                    "Won",
                    "Lost",
                    "Win Rate",
                    "Avg Value",
                    "Revenue",
                  ].map((h) => (
                    <th
                      key={h}
                      className={cn(
                        "px-4 py-3 text-xs font-semibold uppercase text-foreground-400",
                        h === "Revenue" ? "text-right" : "text-left",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.categories.map((cat) => (
                  <tr
                    key={cat.category}
                    className="cursor-pointer border-b border-background-100/60 hover:bg-background-50"
                    onClick={() => {
                      window.location.href = `/tenders?category=${encodeURIComponent(cat.category)}`;
                    }}
                  >
                    <td className="px-4 py-3 font-medium">{cat.category}</td>
                    <td className="px-4 py-3">{cat.bid}</td>
                    <td className="px-4 py-3 text-emerald-600">{cat.won}</td>
                    <td className="px-4 py-3 text-rose-600">{cat.lost}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          winRateBadge(cat.winRate),
                        )}
                      >
                        {formatWinRate(cat.winRate)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {cat.avgValue == null
                        ? "—"
                        : formatIndianCurrency(cat.avgValue)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {formatIndianCurrency(cat.totalRevenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-5 md:p-6">
        <SectionHeading>Win/Loss Distribution</SectionHeading>
        {report.categories.length === 0 ? (
          <p className="py-8 text-center text-sm text-foreground-500">
            No category performance data available.
          </p>
        ) : (
          <>
            <div className="space-y-4">
              {report.categories.map((cat) => {
                const decided = cat.won + cat.lost;
                const winPct = decided > 0 ? (cat.won / decided) * 100 : 0;
                const lossPct = decided > 0 ? (cat.lost / decided) * 100 : 0;
                return (
                  <div key={cat.category}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground-800">
                        {cat.category}
                      </span>
                      <span className="text-foreground-500">
                        {cat.won}W / {cat.lost}L
                      </span>
                    </div>
                    <div className="flex h-5 overflow-hidden rounded-full bg-background-200">
                      <div
                        className="flex items-center justify-center bg-emerald-400 text-[10px] font-bold text-white"
                        style={{ width: `${winPct}%` }}
                      >
                        {winPct >= 10 ? `${winPct.toFixed(0)}%` : ""}
                      </div>
                      <div
                        className="flex items-center justify-center bg-rose-300 text-[10px] font-bold text-white"
                        style={{ width: `${lossPct}%` }}
                      >
                        {lossPct >= 10 ? `${lossPct.toFixed(0)}%` : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center gap-4 text-xs text-foreground-500">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-emerald-400" /> Won
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-rose-300" /> Lost
              </span>
            </div>
          </>
        )}
      </div>

      <div className="card p-5 md:p-6">
        <SectionHeading>Top Performing Clients</SectionHeading>
        {report.clients.length === 0 ? (
          <p className="py-8 text-center text-sm text-foreground-500">
            No client performance data available.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-background-200/60">
                  {["#", "Client", "Category", "Tenders Won", "Revenue"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase text-foreground-400"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {report.clients.map((client, index) => (
                  <tr
                    key={client.client}
                    className="border-b border-background-100/60"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                          index < 3
                            ? "bg-amber-100 text-amber-700"
                            : "bg-background-100 text-foreground-500",
                        )}
                      >
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{client.client}</td>
                    <td className="px-4 py-3 text-foreground-500">
                      {client.category ?? "—"}
                    </td>
                    <td className="px-4 py-3">{client.tendersWon}</td>
                    <td className="px-4 py-3 font-semibold">
                      {formatIndianCurrency(client.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

