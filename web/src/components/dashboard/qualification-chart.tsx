"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import {
  DECISION_CHART_COLORS,
  STATUS_DISPLAY_LABELS,
  TENDER_STATUSES,
  type TenderStatus,
} from "@/lib/tender-status";

type QualificationChartProps = {
  byStatus: Record<string, number>;
};

export function QualificationChart({ byStatus }: QualificationChartProps) {
  const data = Object.entries(byStatus)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      status,
      label:
        status in STATUS_DISPLAY_LABELS
          ? STATUS_DISPLAY_LABELS[status as TenderStatus]
          : status === "NOT_EVALUATED"
            ? "Not evaluated"
            : status.replace(/_/g, " "),
      count,
      fill:
        DECISION_CHART_COLORS[status as TenderStatus | "NOT_EVALUATED"] ??
        "#94a3b8",
    }));

  const total = data.reduce((sum, item) => sum + item.count, 0);

  if (total === 0) {
    return (
      <p className="py-12 text-center text-sm text-text-muted">
        No decision data yet. Evaluated tenders will appear here.
      </p>
    );
  }

  if (total <= 5) {
    return (
      <div className="space-y-4">
        {data.map((item) => (
          <div key={item.status} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-text-secondary">{item.label}</span>
              <span className="font-semibold text-slate-950 dark:text-slate-50">
                {item.count}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(item.count / total) * 100}%`,
                  backgroundColor: item.fill,
                }}
              />
            </div>
          </div>
        ))}
        <p className="pt-2 text-center text-xs text-text-muted">
          {total} evaluated tender{total === 1 ? "" : "s"}
        </p>
      </div>
    );
  }

  return (
    <div className="h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={68}
            outerRadius={96}
            paddingAngle={2}
          >
            {data.map((entry) => (
              <Cell key={entry.status} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: "1px solid var(--border)",
              fontSize: 13,
            }}
          />
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-slate-950 font-heading text-2xl font-bold dark:fill-slate-50"
          >
            {total}
          </text>
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        {data.map((item) => (
          <div key={item.status} className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: item.fill }}
            />
            <span className="text-text-secondary">{item.label}</span>
            <span className="font-medium text-slate-950 dark:text-slate-50">
              {item.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** All five decision statuses may appear in the distribution chart. */
export function decisionChartStatusKeys(): readonly string[] {
  return TENDER_STATUSES;
}
