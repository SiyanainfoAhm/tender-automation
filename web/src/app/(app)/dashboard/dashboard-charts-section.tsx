import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { QualificationChart } from "@/components/dashboard/qualification-chart";
import { SourceChart } from "@/components/dashboard/source-chart";
import { ErrorState } from "@/components/ui/error-state";
import { isAppError } from "@/lib/errors/app-error";
import { getDashboardMetrics } from "@/server/repositories/analyticsRepository";

export async function DashboardChartsSection() {
  try {
    const metrics = await getDashboardMetrics();
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardSection title="Decision distribution">
          <QualificationChart byStatus={metrics.byStatus} />
        </DashboardSection>
        <DashboardSection title="Source distribution">
          <SourceChart bySource={metrics.bySource} />
        </DashboardSection>
      </div>
    );
  } catch (error) {
    const correlationId = isAppError(error) ? error.correlationId : undefined;
    return (
      <ErrorState
        title="Unable to load charts"
        message="Chart data could not be loaded."
        correlationId={correlationId}
        compact
      />
    );
  }
}
