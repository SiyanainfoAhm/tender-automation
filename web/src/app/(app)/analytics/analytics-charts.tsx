"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  GO: "#059669",
  CONDITIONAL_GO: "#d97706",
  PARTNER_BID: "#0284c7",
  VERIFY: "#ea580c",
  NO_GO: "#dc2626",
  NOT_EVALUATED: "#94a3b8",
};

type AnalyticsData = Awaited<
  ReturnType<typeof import("@/server/repositories/analyticsRepository").getAnalytics>
>;

type AnalyticsChartsProps = {
  data: AnalyticsData;
};

export function AnalyticsCharts({ data }: AnalyticsChartsProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="Tenders by day">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data.byDay}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="TENDER247"
              stroke="#2563eb"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="BIDASSIST"
              stroke="#64748b"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="By qualification status">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={data.byStatus}
              dataKey="count"
              nameKey="status"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={95}
              paddingAngle={2}
            >
              {data.byStatus.map((entry) => (
                <Cell
                  key={entry.status}
                  fill={STATUS_COLORS[entry.status] ?? "#94a3b8"}
                />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Value bands">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.valueBands}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="band" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top categories">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.byCategory} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              tick={{ fontSize: 10 }}
            />
            <Tooltip />
            <Bar dataKey="count" fill="#0284c7" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top states" className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.byState}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#059669" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
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
      className={`rounded-[14px] border border-border bg-surface p-6 shadow-sm ${className ?? ""}`}
    >
      <h3 className="font-heading mb-4 text-base font-semibold text-text-primary">
        {title}
      </h3>
      {children}
    </div>
  );
}
