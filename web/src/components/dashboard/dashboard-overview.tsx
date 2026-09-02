"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Handshake,
  HelpCircle,
  IndianRupee,
  Percent,
  Search,
  Send,
  Shield,
  Trophy,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  DASHBOARD_DATE_BASIS_LABELS,
  DASHBOARD_DATE_BASES,
  DASHBOARD_PERIOD_LABELS,
  DASHBOARD_PERIODS,
  type DashboardDateBasis,
  type DashboardPeriod,
} from "@/lib/dashboard/time-range";
import type { DashboardOverview } from "@/lib/dashboard/types";
import { financialExposureEmptySubtitles } from "@/lib/dashboard/financial-metrics";
import { formatIndianCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function VolumeTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { label?: string; count?: number; value?: number } }>;
  mode: "value" | "count";
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md">
      <p className="text-[13px] font-medium text-slate-900">{row.label}</p>
      <p className="mt-0.5 text-xs text-slate-500">
        {mode === "value"
          ? formatIndianCurrency(Number(row.value) || 0)
          : `${Number(row.count) || 0} tenders`}
      </p>
    </div>
  );
}

type DashboardOverviewProps = {
  data: DashboardOverview;
};

const PIPELINE_ICONS = {
  verify: HelpCircle,
  under_evaluation: Search,
  may_bid: ClipboardCheck,
  will_bid: CheckCircle2,
  partnership: Handshake,
  submitted: Send,
} as const;

const KPI_ICONS = {
  pipelineTenders: Briefcase,
  pipelineValue: IndianRupee,
  winRate: Percent,
  wonProjects: Trophy,
  emdCommitted: Shield,
  activePbg: Shield,
} as const;

const KPI_TONES = {
  green: "bg-emerald-50 text-emerald-700",
  orange: "bg-amber-50 text-amber-700",
  blue: "bg-sky-50 text-sky-700",
  slate: "bg-slate-100 text-slate-600",
  violet: "bg-violet-50 text-violet-700",
} as const;

function urgencyClass(urgency: DashboardOverview["upcomingDeadlines"][number]["urgency"]) {
  if (urgency === "overdue") return "text-rose-600";
  if (urgency === "urgent") return "text-amber-600";
  if (urgency === "soon") return "text-orange-500";
  return "text-emerald-600";
}

function urgencyLabel(
  daysLeft: number,
  urgency: DashboardOverview["upcomingDeadlines"][number]["urgency"],
) {
  if (urgency === "overdue") return "Past due";
  if (daysLeft === 0) return "Due today";
  if (daysLeft === 1) return "1 day";
  return `${daysLeft} days`;
}

export function DashboardOverviewClient({ data }: DashboardOverviewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [chartMode, setChartMode] = useState<"value" | "count">("value");

  const showBanner = !bannerDismissed && data.expiringDocuments.length > 0;

  const navigateFilters = (
    period: DashboardPeriod,
    dateBasis: DashboardDateBasis,
  ) => {
    const params = new URLSearchParams();
    params.set("period", period);
    params.set("dateBasis", dateBasis);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const chartData = useMemo(
    () =>
      data.volumeTrend.map((point) => ({
        ...point,
        display: chartMode === "value" ? point.value / 1_00_00_000 : point.count,
      })),
    [chartMode, data.volumeTrend],
  );

  const financialSubs = useMemo(
    () => financialExposureEmptySubtitles(data.financialExposure),
    [data.financialExposure],
  );

  const financialCards = useMemo(
    () => [
      {
        label: "Total Fees",
        value: data.financialExposure.totalFeesLabel,
        sub: financialSubs.totalFeesSub,
      },
      {
        label: "Refundable",
        value: data.financialExposure.refundableLabel,
        sub: financialSubs.refundableSub,
      },
      {
        label: "Active PBG",
        value: data.financialExposure.activePbgLabel,
        sub: financialSubs.activePbgSub,
      },
      {
        label: "PBG Expiring ≤ 90d",
        value: data.financialExposure.pbgExpiring90dLabel,
        sub: financialSubs.pbgExpiringSub,
      },
    ],
    [data.financialExposure, financialSubs],
  );

  return (
    <div
      className={cn("space-y-5", pending && "opacity-80")}
      aria-busy={pending}
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-1">
          <h1 className="page-title">Executive Dashboard</h1>
          <p className="text-sm text-text-secondary">
            Portfolio health for leadership — pipeline, execution &amp; financial
            exposure
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">
              Date Based On
            </span>
            <Select
              value={data.dateBasis}
              disabled={pending}
              onValueChange={(value) =>
                navigateFilters(data.period, value as DashboardDateBasis)
              }
            >
              <SelectTrigger className="h-9 w-[160px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DASHBOARD_DATE_BASES.map((basis) => (
                  <SelectItem key={basis} value={basis}>
                    {DASHBOARD_DATE_BASIS_LABELS[basis]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            className="inline-flex w-fit flex-wrap items-center rounded-full border border-slate-200 bg-slate-50 p-1"
            role="tablist"
            aria-label="Dashboard period"
          >
            {DASHBOARD_PERIODS.map((period) => {
              const active = data.period === period;
              return (
                <button
                  key={period}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={pending}
                  onClick={() => navigateFilters(period, data.dateBasis)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors sm:text-sm",
                    active
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-800",
                    pending && "cursor-wait opacity-70",
                  )}
                >
                  {DASHBOARD_PERIOD_LABELS[period]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showBanner ? (
        <div className="relative overflow-hidden rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 sm:px-5">
          <button
            type="button"
            aria-label="Dismiss expiry alert"
            className="absolute right-3 top-3 rounded-md p-1 text-rose-400 hover:bg-rose-100"
            onClick={() => setBannerDismissed(true)}
          >
            <X className="size-4" />
          </button>
          <div className="flex items-start gap-3 pr-8">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-600" />
            <div>
              <p className="text-sm font-semibold text-rose-900">
                {data.expiringDocuments.length} document
                {data.expiringDocuments.length === 1 ? "" : "s"} expiring soon
              </p>
              <Link
                href="/documents"
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-rose-800 hover:underline"
              >
                Review documents
                <ChevronRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {data.summaryStats.map((stat) => (
          <div
            key={stat.key}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3.5"
          >
            <p className="text-xs font-medium text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {stat.value}
            </p>
            <p className="mt-1 text-xs text-slate-500">{stat.supporting}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {data.kpiCards.map((kpi) => {
          const Icon =
            KPI_ICONS[kpi.key as keyof typeof KPI_ICONS] || Briefcase;
          return (
            <div
              key={kpi.key}
              className="rounded-xl border border-slate-200 bg-white p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
                <div
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg",
                    KPI_TONES[kpi.tone],
                  )}
                >
                  <Icon className="size-4" />
                </div>
              </div>
              <p className="mt-2 text-xl font-semibold tabular-nums text-slate-900">
                {kpi.value}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{kpi.supporting}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 xl:col-span-2">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              Bid Pipeline by Stage
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {data.pipelineTotal.toLocaleString("en-IN")} opportunities{" "}
              {DASHBOARD_PERIOD_LABELS[data.period].toLowerCase()}
            </p>
          </div>
          <ul className="space-y-3.5">
            {data.pipeline.map((stage) => {
              const Icon = PIPELINE_ICONS[stage.key];
              return (
                <li key={stage.key} className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="w-4 text-xs font-semibold text-slate-400">
                      {stage.number}
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
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800">
                          {stage.label}
                          <span className="ml-2 text-xs font-normal text-slate-500">
                            {stage.count} tender{stage.count === 1 ? "" : "s"}
                          </span>
                        </p>
                        <p className="text-sm font-semibold tabular-nums text-slate-900">
                          {stage.valueLabel}
                        </p>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn("h-full rounded-full", stage.barClass)}
                          style={{
                            width: `${Math.max(stage.progress, stage.count > 0 ? 4 : 0)}%`,
                          }}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {stage.progress}% of pipeline value
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              Financial Exposure
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Bid fees, security deposits &amp; guarantees
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {financialCards.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-slate-100 bg-slate-50/80 p-3"
              >
                <p className="text-[11px] font-medium text-slate-500">
                  {item.label}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {item.value}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">{item.sub}</p>
              </div>
            ))}
          </div>
          <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Breakdown by fee type
          </p>
          <ul className="space-y-2.5">
            {data.financialExposure.breakdown.map((row) => (
              <li key={row.key}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-700">
                    {row.label}
                    <span className="ml-1 text-xs text-slate-400">
                      ({row.count})
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {row.valueLabel}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-amber-500"
                    style={{ width: `${Math.max(row.progress, row.count > 0 ? 6 : 0)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 xl:col-span-2">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Pipeline Value &amp; Volume
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {data.volumeSubtitle}
              </p>
            </div>
            <div
              className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1"
              role="tablist"
              aria-label="Chart metric"
            >
              {(
                [
                  ["value", "Value (₹ Cr)"],
                  ["count", "Tender Count"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={chartMode === mode}
                  onClick={() => setChartMode(mode)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    chartMode === mode
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[260px] w-full">
            {data.volumeTrend.every((p) => p.count === 0 && p.value === 0) ? (
              <p className="flex h-full items-center justify-center text-sm text-slate-500">
                No tender intake in the last 12 months.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
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
                    allowDecimals={chartMode === "value"}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    tickFormatter={(v) =>
                      chartMode === "value" ? String(v) : String(v)
                    }
                  />
                  <Tooltip
                    content={<VolumeTooltip mode={chartMode} />}
                  />
                  <Bar
                    dataKey="display"
                    name={chartMode === "value" ? "Value" : "Tenders"}
                    fill="#10b981"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              By Category
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {data.categoryTotal.toLocaleString("en-IN")} tenders{" "}
              {DASHBOARD_PERIOD_LABELS[data.period].toLowerCase()}
            </p>
          </div>
          <ul className="space-y-2.5">
            {data.categories.map((cat) => (
              <li key={cat.key}>
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <Building2 className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {cat.label}
                        <span className="ml-1 text-xs font-normal text-slate-500">
                          {cat.count}
                        </span>
                      </p>
                      <p className="text-xs font-semibold tabular-nums text-slate-900">
                        {cat.valueLabel}
                      </p>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-sky-500"
                        style={{
                          width: `${Math.max(cat.progress, cat.count > 0 ? 6 : 0)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.sources.map((src) => (
              <span
                key={src.key}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
              >
                {src.label}
                <span className="tabular-nums text-slate-900">{src.count}</span>
              </span>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 xl:col-span-2">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              Won Projects — Execution Portfolio
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Tender wins plus company past experience on file
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              {
                label: "Active Projects",
                value: String(data.wonPortfolio.activeProjects),
              },
              {
                label: "In Execution Value",
                value: data.wonPortfolio.inExecutionValueLabel,
              },
              {
                label: "Completed",
                value: String(data.wonPortfolio.completed),
              },
              {
                label: "Milestones Done",
                value: `${data.wonPortfolio.milestonesDone} / ${data.wonPortfolio.milestonesTotal}`,
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-slate-100 bg-slate-50/80 p-3"
              >
                <p className="text-[11px] font-medium text-slate-500">
                  {card.label}
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {card.value}
                </p>
              </div>
            ))}
          </div>
          <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            By execution status
          </p>
          <ul className="space-y-2.5">
            {data.wonPortfolio.byStatus.map((row) => (
              <li key={row.key}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-2 text-slate-700">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    {row.label}
                    <span className="text-xs text-slate-400">
                      ({row.count})
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {row.valueLabel}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(row.progress, row.count > 0 ? 6 : 0)}%`,
                      backgroundColor: row.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Upcoming Deadlines
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">Nearest first</p>
            </div>
            <Link
              href="/tenders?quickDate=closing_7"
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
            >
              <CalendarDays className="size-3.5" />
              View all
            </Link>
          </div>
          {data.upcomingDeadlines.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No upcoming deadlines in the next 45 days.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.upcomingDeadlines.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 transition-colors hover:border-slate-200 hover:bg-white"
                  >
                    <div className="flex size-11 shrink-0 flex-col items-center justify-center rounded-md border border-slate-200 bg-white">
                      <span className="text-[10px] font-semibold uppercase text-slate-400">
                        {item.monthLabel}
                      </span>
                      <span className="text-base font-semibold leading-none text-slate-900">
                        {item.dayLabel}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        #{item.reference} · {item.valueLabel}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                          {item.statusLabel}
                        </span>
                        <span
                          className={cn(
                            "text-[11px] font-semibold",
                            urgencyClass(item.urgency),
                          )}
                        >
                          {urgencyLabel(item.daysLeft, item.urgency)}
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
