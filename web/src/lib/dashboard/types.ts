import type { DashboardPipelineStage } from "@/lib/dashboard/pipeline";
import type {
  DashboardDateBasis,
  DashboardPeriod,
} from "@/lib/dashboard/time-range";

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
  /** Share of total pipeline value (0–100). */
  progress: number;
  color: string;
  barClass: string;
  iconBg: string;
  iconText: string;
};

export type DashboardVolumePoint = {
  label: string;
  /** Month key yyyy-MM */
  key: string;
  count: number;
  value: number;
};

export type DashboardCategoryRow = {
  key: string;
  label: string;
  count: number;
  totalValue: number;
  valueLabel: string;
  progress: number;
};

export type DashboardSourcePill = {
  key: string;
  label: string;
  count: number;
};

export type DashboardFeeBreakdownRow = {
  key: string;
  label: string;
  count: number;
  totalValue: number;
  valueLabel: string;
  progress: number;
};

export type DashboardFinancialExposure = {
  totalFees: number;
  totalFeesLabel: string;
  pendingFees: number;
  pendingFeesLabel: string;
  refundable: number;
  refundableLabel: string;
  returned: number;
  returnedLabel: string;
  activePbg: number;
  activePbgLabel: string;
  expiredPbg: number;
  expiredPbgLabel: string;
  pbgExpiring90d: number;
  pbgExpiring90dLabel: string;
  pbgExpiringCount: number;
  breakdown: DashboardFeeBreakdownRow[];
};

export type DashboardExecutionStatusRow = {
  key: string;
  label: string;
  count: number;
  totalValue: number;
  valueLabel: string;
  progress: number;
  color: string;
};

export type DashboardWonPortfolio = {
  activeProjects: number;
  inExecutionValue: number;
  inExecutionValueLabel: string;
  completed: number;
  milestonesDone: number;
  milestonesTotal: number;
  byStatus: DashboardExecutionStatusRow[];
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
  urgency: "overdue" | "urgent" | "soon" | "ok";
  valueLabel: string;
  href: string;
};

export type DashboardSummaryStat = {
  key: string;
  label: string;
  value: string;
  supporting: string;
};

export type DashboardKpiCard = {
  key: string;
  label: string;
  value: string;
  supporting: string;
  tone: "green" | "orange" | "blue" | "slate" | "violet";
};

export type DashboardOverview = {
  period: DashboardPeriod;
  dateBasis: DashboardDateBasis;
  /** @deprecated alias of period for older clients */
  range: DashboardPeriod;
  summaryStats: DashboardSummaryStat[];
  kpiCards: DashboardKpiCard[];
  expiringDocuments: DashboardExpiringDocument[];
  pipeline: DashboardPipelineStageRow[];
  pipelineTotal: number;
  pipelineValueTotal: number;
  pipelineValueLabel: string;
  volumeTrend: DashboardVolumePoint[];
  volumeSubtitle: string;
  categories: DashboardCategoryRow[];
  categoryTotal: number;
  sources: DashboardSourcePill[];
  financialExposure: DashboardFinancialExposure;
  wonPortfolio: DashboardWonPortfolio;
  upcomingDeadlines: DashboardDeadlineItem[];
};
