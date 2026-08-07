"use client";

import {
  Bar,
  BarChart,
  Cell,
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
import type { DashboardMetrics } from "@/server/repositories/analyticsRepository";

const SOURCE_COLORS: Record<string, string> = {
  TENDER247: "#2563eb",
  BIDASSIST: "#0891b2",
};

type DashboardChartsProps = {
  metrics: DashboardMetrics;
};

/** Legacy combined charts — kept compact for any remaining callers. */
export function DashboardCharts({ metrics }: DashboardChartsProps) {
  const statusData = Object.entries(metrics.byStatus)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      name: formatDecisionStatus(status),
      fullName: formatDecisionStatus(status),
      value: count,
      key: status,
    }));

  const sourceData = Object.entries(metrics.bySource).map(([source, count]) => ({
    name: source,
    fullName: source,
    count,
  }));

  return (
    <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-50">
          Qualification status
        </h3>
        <div className="h-[210px]">
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={74}
                paddingAngle={2}
              >
                {statusData.map((entry) => (
                  <Cell
                    key={entry.key}
                    fill={
                      DECISION_CHART_COLORS[
                        entry.key as TenderStatus | "NOT_EVALUATED"
                      ] ?? "#94a3b8"
                    }
                  />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltipContent />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-50">
          By source portal
        </h3>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={sourceData}
              margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
            >
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {sourceData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={SOURCE_COLORS[entry.name] ?? "#2563eb"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
