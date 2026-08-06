"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DashboardMetrics } from "@/server/repositories/analyticsRepository";

const STATUS_COLORS: Record<string, string> = {
  GO: "#059669",
  CONDITIONAL_GO: "#d97706",
  PARTNER_BID: "#0284c7",
  VERIFY: "#ea580c",
  NO_GO: "#dc2626",
  NOT_EVALUATED: "#94a3b8",
};

const SOURCE_COLORS: Record<string, string> = {
  TENDER247: "#2563eb",
  BIDASSIST: "#64748b",
};

type DashboardChartsProps = {
  metrics: DashboardMetrics;
};

export function DashboardCharts({ metrics }: DashboardChartsProps) {
  const statusData = Object.entries(metrics.byStatus)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      name: status.replace(/_/g, " "),
      value: count,
      key: status,
    }));

  const sourceData = Object.entries(metrics.bySource).map(([source, count]) => ({
    name: source,
    count,
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-[14px] border border-border bg-surface p-6 shadow-sm">
        <h3 className="font-heading mb-4 text-base font-semibold text-text-primary">
          Qualification status
        </h3>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
              >
                {statusData.map((entry) => (
                  <Cell
                    key={entry.key}
                    fill={STATUS_COLORS[entry.key] ?? "#94a3b8"}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-[14px] border border-border bg-surface p-6 shadow-sm">
        <h3 className="font-heading mb-4 text-base font-semibold text-text-primary">
          By source portal
        </h3>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sourceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
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
