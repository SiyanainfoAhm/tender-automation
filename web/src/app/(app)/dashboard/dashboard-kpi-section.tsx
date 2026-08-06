import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

import { MetricCard } from "@/components/dashboard/metric-card";
import { ErrorState } from "@/components/ui/error-state";
import { isAppError } from "@/lib/errors/app-error";
import { getDashboardMetrics } from "@/server/repositories/analyticsRepository";

export async function DashboardKpiSection() {
  try {
    const metrics = await getDashboardMetrics();
    const kpis = [
      {
        label: "Total tenders",
        value: metrics.totalTenders.toLocaleString("en-IN"),
        hint: "Across all sources",
        icon: FileText,
        variant: "total" as const,
      },
      {
        label: "New today",
        value: metrics.newToday.toLocaleString("en-IN"),
        hint: "First seen today",
        icon: TrendingUp,
        variant: "new" as const,
      },
      {
        label: "Closing soon",
        value: metrics.closingWithin3Days.toLocaleString("en-IN"),
        hint: "Within 3 days",
        icon: Clock,
        variant: "closing" as const,
      },
      {
        label: "GO opportunities",
        value: metrics.goOpportunities.toLocaleString("en-IN"),
        hint: "Qualification status GO only",
        icon: CheckCircle2,
        variant: "go" as const,
      },
      {
        label: "Pending verification",
        value: metrics.pendingVerification.toLocaleString("en-IN"),
        hint: "Status VERIFY",
        icon: ShieldAlert,
        variant: "verify" as const,
      },
      {
        label: "Manual review",
        value: metrics.manualReview.toLocaleString("en-IN"),
        hint: "Flagged for attention",
        icon: AlertTriangle,
        variant: "manual" as const,
      },
    ];

    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((kpi) => (
          <MetricCard key={kpi.label} {...kpi} />
        ))}
      </div>
    );
  } catch (error) {
    const correlationId = isAppError(error) ? error.correlationId : undefined;
    return (
      <ErrorState
        title="Unable to load metrics"
        message="Dashboard KPIs could not be loaded."
        correlationId={correlationId}
        compact
      />
    );
  }
}
