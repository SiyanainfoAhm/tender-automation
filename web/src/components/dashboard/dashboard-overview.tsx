"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  FolderKanban,
  Handshake,
  Percent,
  Search,
  Send,
  Sparkles,
  Trophy,
  Upload,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartTooltipContent } from "@/components/charts/chart-tooltip";
import type { DashboardKpiTone } from "@/lib/dashboard/kpi-format";
import {
  DASHBOARD_TIME_RANGE_LABELS,
  DASHBOARD_TIME_RANGES,
  type DashboardTimeRange,
} from "@/lib/dashboard/time-range";
import type { DashboardOverview } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { qualificationStatusStyles } from "@/components/tenders/tender-status-styles";
import type { TenderStatus } from "@/lib/tender-status";

type DashboardOverviewProps = {
  data: DashboardOverview;
};

const KPI_ICONS = {
  totalTenders: FileText,
  activeBids: Briefcase,
  winRate: Percent,
  pendingReview: ClipboardCheck,
} as const;

const KPI_ICON_BG = {
  totalTenders: "bg-sky-50 text-sky-600",
  activeBids: "bg-violet-50 text-violet-600",
  winRate: "bg-emerald-50 text-emerald-600",
  pendingReview: "bg-amber-50 text-amber-600",
} as const;

const PIPELINE_ICONS = {
  screening: Search,
  partnership: Handshake,
  will_bid: CheckCircle2,
  submitted: Send,
  won: Trophy,
} as const;

function comparisonToneClass(tone: DashboardKpiTone): string {
  if (tone === "positive") return "text-emerald-600";
  if (tone === "negative") return "text-rose-600";
  return "text-foreground-500";
}

function getActivityIcon(kind: DashboardOverview["recentActivity"][number]["kind"]) {
  switch (kind) {
    case "imported":
      return FolderKanban;
    case "status":
      return CheckCircle2;
    case "qualification":
      return Bot;
    case "document":
      return Upload;
    default:
      return Sparkles;
  }
}

function severityChipClass(severity: "critical" | "warning" | "expired") {
  if (severity === "expired" || severity === "critical") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function statusChipClass(status: string | null) {
  if (status && status in qualificationStatusStyles) {
    const style = qualificationStatusStyles[status as TenderStatus];
    return cn(style.bg, style.text, style.border);
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function DashboardOverviewClient({ data }: DashboardOverviewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const showBanner =
    !bannerDismissed && data.expiringDocuments.length > 0;

  const onRangeChange = (range: DashboardTimeRange) => {
    if (range === data.range) return;
    const params = new URLSearchParams();
    params.set("range", range);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const donutTotal = useMemo(
    () =>
      data.tenderStatusDistribution.reduce((sum, slice) => sum + slice.count, 0),
    [data.tenderStatusDistribution],
  );

  return (
    <div className="space-y-5">
      {/* A. Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm text-text-secondary">
            Overview of your tender pipeline and bid activity
          </p>
        </div>

        <div
          className="inline-flex w-fit flex-wrap items-center rounded-full border border-slate-200 bg-slate-50 p-1 shadow-sm"
          role="tablist"
          aria-label="Time range"
        >
          {DASHBOARD_TIME_RANGES.map((range) => {
            const active = data.range === range;
            return (
              <button
                key={range}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={pending}
                onClick={() => onRangeChange(range)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors sm:text-sm",
                  active
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-800",
                  pending && "cursor-wait opacity-70",
                )}
              >
                {DASHBOARD_TIME_RANGE_LABELS[range]}
              </button>
            );
          })}
        </div>
      </div>

      {/* B. Document expiry banner */}
      {showBanner ? (
        <div className="relative overflow-hidden rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 via-orange-50 to-amber-50 px-4 py-4 sm:px-5">
          <button
            type="button"
            aria-label="Dismiss expiry alert"
            className="absolute right-3 top-3 rounded-md p-1 text-rose-400 hover:bg-rose-100 hover:text-rose-600"
            onClick={() => setBannerDismissed(true)}
          >
            <X className="size-4" />
          </button>
          <div className="flex flex-col gap-3 pr-8 sm:flex-row sm:items-start">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
              <AlertTriangle className="size-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-2.5">
              <div>
                <p className="text-sm font-semibold text-rose-900 sm:text-base">
                  {data.expiringDocuments.length} document
                  {data.expiringDocuments.length === 1 ? "" : "s"} expiring soon
                </p>
                <p className="text-xs text-rose-700/80 sm:text-sm">
                  Critical renewals needed to maintain bidding eligibility
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.expiringDocuments.map((doc) => (
                  <span
                    key={doc.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                      severityChipClass(doc.severity),
                    )}
                  >
                    <FileText className="size-3.5 shrink-0 opacity-70" />
                    <span className="max-w-[220px] truncate">{doc.name}</span>
                    <span className="font-semibold tabular-nums">
                      {doc.daysLeft < 0
                        ? "Expired"
                        : doc.daysLeft === 0
                          ? "Today"
                          : `${doc.daysLeft}d`}
                    </span>
                  </span>
                ))}
              </div>
              <Link
                href="/documents"
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-800 hover:underline"
              >
                Review documents
                <ChevronRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {/* C. KPI cards — wireframe: label → value → comparison; icon top-right */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.kpiCards.map((kpi) => {
          const Icon = KPI_ICONS[kpi.key];
          return (
            <div
              key={kpi.key}
              className="rounded-xl border border-border bg-card p-4 transition-all hover:border-primary-300/60 md:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground-500">
                    {kpi.label}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-2xl font-bold text-foreground-900 md:text-3xl",
                      pending && "animate-pulse text-foreground-300",
                    )}
                  >
                    {kpi.value}
                  </p>
                  <p
                    className={cn(
                      "mt-1.5 text-xs font-medium",
                      comparisonToneClass(kpi.comparison.tone),
                    )}
                  >
                    {kpi.comparison.text}
                  </p>
                </div>
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    KPI_ICON_BG[kpi.key],
                  )}
                >
                  <Icon className="size-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* D. Active Bid Pipeline */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="section-title">Active Bid Pipeline</h2>
          <p className="text-xs font-medium text-slate-500 sm:text-sm">
            {data.pipelineTotal.toLocaleString("en-IN")} tenders in pipeline
          </p>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 lg:gap-0 lg:overflow-visible">
          {data.pipeline.map((stage, index) => {
            const Icon = PIPELINE_ICONS[stage.key];
            return (
              <div key={stage.key} className="flex min-w-[148px] flex-1 items-stretch lg:min-w-0">
                <div className="flex w-full flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {String(stage.number).padStart(2, "0")}
                    </span>
                    <div
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg",
                        stage.iconBg,
                        stage.iconText,
                      )}
                    >
                      <Icon className="size-4" />
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-medium text-slate-600">
                    {stage.label}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
                    {stage.count}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">
                    {stage.valueLabel}
                  </p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200/80">
                    <div
                      className={cn("h-full rounded-full transition-all", stage.barClass)}
                      style={{ width: `${Math.max(stage.progress, stage.count > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                </div>
                {index < data.pipeline.length - 1 ? (
                  <div className="hidden items-center px-1 text-slate-300 lg:flex">
                    <ArrowRight className="size-4" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* E. Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 xl:col-span-3">
          <div className="mb-4">
            <h2 className="section-title">Tender Volume Trend</h2>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
              {data.volumeSubtitle}
            </p>
          </div>
          <div className="h-[260px] w-full">
            {data.tenderVolumeTrend.every((p) => p.count === 0) ? (
              <p className="flex h-full items-center justify-center text-sm text-slate-500">
                No tender imports in this period.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.tenderVolumeTrend}
                  margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                  />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="count"
                    name="Tenders"
                    fill="#3b82f6"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 xl:col-span-2">
          <div className="mb-2">
            <h2 className="section-title">Tender Status</h2>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
              Distribution
            </p>
          </div>
          {donutTotal === 0 ? (
            <p className="flex h-[260px] items-center justify-center text-sm text-slate-500">
              No status data in this period.
            </p>
          ) : (
            <div className="flex flex-col">
              <div className="mx-auto h-[200px] w-full max-w-[220px]">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={data.tenderStatusDistribution}
                      dataKey="count"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={2}
                    >
                      {data.tenderStatusDistribution.map((slice) => (
                        <Cell key={slice.key} fill={slice.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltipContent />} />
                    <text
                      x="50%"
                      y="50%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="fill-slate-950 text-lg font-semibold"
                    >
                      {donutTotal}
                    </text>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                {data.tenderStatusDistribution.map((slice) => (
                  <div
                    key={slice.key}
                    className="flex items-center gap-1.5 text-[12px]"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: slice.color }}
                    />
                    <span className="text-slate-600">{slice.label}</span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {slice.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* F. Bottom row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="section-title">Recent Activity</h2>
            <Link
              href="/tenders"
              className="text-xs font-semibold text-blue-600 hover:underline sm:text-sm"
            >
              View all
            </Link>
          </div>
          {data.recentActivity.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No recent activity in this period.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentActivity.map((item) => {
                const Icon = getActivityIcon(item.kind);
                return (
                  <li
                    key={item.id}
                    className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-5 text-slate-800">
                        {item.sentence}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.relativeTime}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="section-title">Upcoming Deadlines</h2>
            <Link
              href="/tenders?quickDate=closing_7"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline sm:text-sm"
            >
              <CalendarDays className="size-3.5" />
              View calendar
            </Link>
          </div>
          {data.upcomingDeadlines.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No upcoming deadlines in the next 45 days.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {data.upcomingDeadlines.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 transition-colors hover:border-slate-200 hover:bg-white"
                  >
                    <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {item.monthLabel}
                      </span>
                      <span className="text-lg font-semibold leading-none text-slate-900">
                        {item.dayLabel}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        #{item.reference}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            statusChipClass(item.status),
                          )}
                        >
                          {item.statusLabel}
                        </span>
                        <span
                          className={cn(
                            "text-[11px] font-semibold",
                            item.daysLeft <= 7
                              ? "text-rose-600"
                              : item.daysLeft <= 14
                                ? "text-amber-600"
                                : "text-slate-500",
                          )}
                        >
                          {item.daysLeft === 0
                            ? "Due today"
                            : `${item.daysLeft} day${item.daysLeft === 1 ? "" : "s"} left`}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
