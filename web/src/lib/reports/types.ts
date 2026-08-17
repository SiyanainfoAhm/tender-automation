export type ReportTab =
  | "overview"
  | "pipeline"
  | "financial"
  | "performance";

export const REPORT_TABS: Array<{
  key: ReportTab;
  label: string;
  icon: string;
}> = [
  { key: "overview", label: "Overview", icon: "ri-dashboard-3-line" },
  { key: "pipeline", label: "Pipeline", icon: "ri-filter-3-line" },
  { key: "financial", label: "Financial", icon: "ri-money-rupee-circle-line" },
  { key: "performance", label: "Performance", icon: "ri-bar-chart-grouped-line" },
];

export function parseReportsTab(
  raw: string | string[] | undefined | null,
): ReportTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (
    value === "pipeline" ||
    value === "financial" ||
    value === "performance"
  ) {
    return value;
  }
  return "overview";
}

export type ReportSummary = {
  tendersBid: number;
  tendersWon: number;
  winRate: number | null;
  revenueWon: number;
  pipelineValue: number;
  avgDealSize: number | null;
  profitMargin: number | null;
  activeTenders: number;
  submittedCount: number;
};

export type MonthlyPerformance = {
  monthKey: string;
  month: string;
  tendersBid: number;
  tendersWon: number;
  revenueWon: number;
  profit: number | null;
};

export type PipelineStageRow = {
  key: string;
  label: string;
  count: number;
  value: number;
  color: string;
  barClass: string;
};

export type PipelineConversion = {
  key: string;
  label: string;
  icon: string;
  from: number;
  to: number;
  rate: number | null;
};

export type PortalPerformance = {
  portal: string;
  portalKey: string;
  total: number;
  won: number;
  lost: number;
  pending: number;
  winRate: number | null;
};

export type AgeingBucket = {
  key: "overdue" | "lt7" | "d7_14" | "d14_30";
  label: string;
  description: string;
  count: number;
  percent: number;
  tone: "rose" | "amber" | "sky" | "emerald";
};

export type CategoryPerformance = {
  category: string;
  bid: number;
  won: number;
  lost: number;
  winRate: number | null;
  avgValue: number | null;
  totalRevenue: number;
  color: string;
};

export type ClientPerformance = {
  client: string;
  category: string | null;
  tendersWon: number;
  tendersBid: number;
  revenue: number;
};

export type ReportsAnalytics = {
  financialYear: string;
  financialYearLabel: string;
  summary: ReportSummary;
  monthlyTrend: MonthlyPerformance[];
  pipeline: PipelineStageRow[];
  pipelineConversions: PipelineConversion[];
  portals: PortalPerformance[];
  ageing: AgeingBucket[];
  monthlyFinancial: MonthlyPerformance[];
  categories: CategoryPerformance[];
  clients: ClientPerformance[];
  costDataAvailable: boolean;
};
