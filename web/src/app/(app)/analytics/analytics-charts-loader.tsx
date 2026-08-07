"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

type AnalyticsData = Awaited<
  ReturnType<typeof import("@/server/repositories/analyticsRepository").getAnalytics>
>;

const AnalyticsCharts = dynamic(
  () => import("./analytics-charts").then((m) => m.AnalyticsCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[300px] rounded-xl" />
        ))}
      </div>
    ),
  },
);

type AnalyticsChartsLoaderProps = {
  data: AnalyticsData;
};

export function AnalyticsChartsLoader({ data }: AnalyticsChartsLoaderProps) {
  return <AnalyticsCharts data={data} />;
}
