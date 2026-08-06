"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardMetrics } from "@/server/repositories/analyticsRepository";

const DashboardCharts = dynamic(
  () => import("./dashboard-charts").then((m) => m.DashboardCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[360px] rounded-[14px]" />
        <Skeleton className="h-[360px] rounded-[14px]" />
      </div>
    ),
  },
);

type DashboardChartsLoaderProps = {
  metrics: DashboardMetrics;
};

export function DashboardChartsLoader({ metrics }: DashboardChartsLoaderProps) {
  return <DashboardCharts metrics={metrics} />;
}
