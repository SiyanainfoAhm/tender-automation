"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartTooltipContent } from "@/components/charts/chart-tooltip";
import { formatDecisionStatus } from "@/lib/analytics/category-display";
import { DECISION_CHART_COLORS, type TenderStatus } from "@/lib/tender-status";
import { cn } from "@/lib/utils";

type AnalyticsData = Awaited<
  ReturnType<typeof import("@/server/repositories/analyticsRepository").getAnalytics>
>;

type AnalyticsChartsProps = {
  data: AnalyticsData;
};

const SOURCE_SERIES = [
  { key: "TENDER247", color: "#2563eb" },
  { key: "BIDASSIST", color: "#0891b2" },
] as const;

export function AnalyticsCharts({ data }: AnalyticsChartsProps) {
  const statusData = data.byStatus
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      ...entry,
      label: formatDecisionStatus(entry.status),
      fullName: formatDecisionStatus(entry.status),
      fill:
        DECISION_CHART_COLORS[entry.status as TenderStatus | "NOT_EVALUATED"] ??
        "#94a3b8",
    }));

  const categoryData = data.byCategory.map((entry) => ({
    ...entry,
    fullName: entry.fullName ?? entry.name,
  }));

  return (
    <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
      <ChartCard title="Tenders by day">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={data.byDay}
              margin={{ top: 6, right: 10, left: 0, bottom: 2 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                width={28}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltipContent
                    formatTitle={({ name }) => name || "Series"}
                  />
                }
              />
              {SOURCE_SERIES.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.key}
                  stroke={series.color}
                  strokeWidth={2}
                  dot={{ r: 2, strokeWidth: 0 }}
                  activeDot={{ r: 3.5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1.5 flex flex-wrap justify-center gap-4 text-[12px] text-slate-600 dark:text-slate-300">
          {SOURCE_SERIES.map((series) => (
            <div key={series.key} className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: series.color }}
              />
              {series.key}
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Qualification status">
        <div className="mx-auto h-[210px] w-full max-w-[260px]">
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie
                data={statusData}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={76}
                paddingAngle={2}
              >
                {statusData.map((entry) => (
                  <Cell key={entry.status} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltipContent />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1.5 flex flex-wrap justify-center gap-x-3 gap-y-1 px-1 text-[12px]">
          {statusData.map((item) => (
            <div key={item.status} className="flex items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.fill }}
              />
              <span className="text-slate-600 dark:text-slate-300">
                {item.label}
              </span>
              <span className="font-medium text-slate-900 dark:text-slate-50">
                {item.count}
              </span>
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Value bands">
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={data.valueBands}
              margin={{ top: 6, right: 6, left: 0, bottom: 2 }}
              barCategoryGap="18%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="band"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis
                allowDecimals={false}
                width={28}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltipContent
                    formatTitle={({ label }) => String(label ?? "Band")}
                  />
                }
              />
              <Bar
                dataKey="count"
                fill="#2563eb"
                radius={[6, 6, 0, 0]}
                maxBarSize={44}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Top categories">
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={categoryData}
              layout="vertical"
              margin={{ top: 2, right: 12, left: 2, bottom: 2 }}
              barCategoryGap="16%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={148}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltipContent titleKey="fullName" />} />
              <Bar
                dataKey="count"
                fill="#0284c7"
                radius={[0, 6, 6, 0]}
                maxBarSize={32}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Top states" className="xl:col-span-2">
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={data.byState}
              margin={{ top: 6, right: 6, left: 0, bottom: 2 }}
              barCategoryGap="16%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                width={28}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltipContent
                    formatTitle={({ label }) => String(label ?? "State")}
                  />
                }
              />
              <Bar
                dataKey="count"
                fill="#059669"
                radius={[6, 6, 0, 0]}
                maxBarSize={44}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm",
        "dark:border-slate-700/60 dark:bg-slate-900/70 dark:shadow-none",
        className,
      )}
    >
      <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-50">
        {title}
      </h3>
      {children}
    </div>
  );
}
