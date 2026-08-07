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

import { ChartTooltipContent } from "@/components/charts/chart-tooltip";
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
      fullName: source,
      count,
      fill: SOURCE_COLORS[source] ?? "#64748b",
    }));

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-text-muted">
        No source data available yet.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap gap-2">
        {data.map((item) => (
          <SourceBadge
            key={item.source}
            source={item.source as TenderSource}
            size="sm"
          />
        ))}
      </div>
      <div className="h-[210px] w-full">
        <ResponsiveContainer width="100%" height={210}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            barCategoryGap="30%"
          >
            <XAxis
              dataKey="source"
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              width={32}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-muted)", opacity: 0.35 }}
              content={<ChartTooltipContent />}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
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
