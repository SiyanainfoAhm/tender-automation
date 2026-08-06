"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";

const SOURCE_COLORS: Record<string, string> = {
  TENDER247: "#2563eb",
  BIDASSIST: "#0891b2",
};

type SourceChartProps = {
  bySource: Record<string, number>;
};

export function SourceChart({ bySource }: SourceChartProps) {
  const data = Object.entries(bySource)
    .filter(([, count]) => count > 0)
    .map(([source, count]) => ({
      source,
      count,
      fill: SOURCE_COLORS[source] ?? "#64748b",
    }));

  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-text-muted">
        No source data available yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {data.map((item) => (
          <SourceBadge
            key={item.source}
            source={item.source as TenderSource}
            size="sm"
          />
        ))}
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barSize={48}>
            <XAxis
              dataKey="source"
              tick={{ fontSize: 12, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 12, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-muted)", opacity: 0.4 }}
              contentStyle={{
                borderRadius: 10,
                border: "1px solid var(--border)",
                fontSize: 13,
              }}
            />
            <Bar dataKey="count" radius={[8, 8, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.source} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
