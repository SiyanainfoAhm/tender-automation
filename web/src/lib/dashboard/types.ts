import type { DashboardPipelineStage } from "@/lib/dashboard/pipeline";
import type { DashboardKpiMetric } from "@/lib/dashboard/kpi-format";
import type { DashboardTimeRange } from "@/lib/dashboard/time-range";

export type DashboardExpiringDocument = {
  id: string;
  name: string;
  daysLeft: number;
  severity: "critical" | "warning" | "expired";
};

export type DashboardPipelineStageRow = {
  key: DashboardPipelineStage;
  label: string;
  number: number;
  count: number;
  totalValue: number;
  valueLabel: string;
  progress: number;
  color: string;
  barClass: string;
  iconBg: string;
  iconText: string;
};

export type DashboardVolumePoint = {
  label: string;
  count: number;
};

export type DashboardStatusSlice = {
  key: string;
  label: string;
  count: number;
  color: string;
};

export type DashboardActivityItem = {
  id: string;
  kind: "imported" | "status" | "qualification" | "document" | "other";
  sentence: string;
  occurredAt: string;
  relativeTime: string;
};

export type DashboardDeadlineItem = {
  id: string;
  title: string;
  reference: string;
  closingDate: string;
  monthLabel: string;
  dayLabel: string;
  status: string | null;
  statusLabel: string;
  daysLeft: number;
  href: string;
};

export type DashboardOverview = {
  range: DashboardTimeRange;
  /** Ordered KPI cards ready for wireframe rendering. */
  kpiCards: DashboardKpiMetric[];
  expiringDocuments: DashboardExpiringDocument[];
  pipeline: DashboardPipelineStageRow[];
  pipelineTotal: number;
  tenderVolumeTrend: DashboardVolumePoint[];
  volumeSubtitle: string;
  tenderStatusDistribution: DashboardStatusSlice[];
  recentActivity: DashboardActivityItem[];
  upcomingDeadlines: DashboardDeadlineItem[];
};
