import { ErrorState } from "@/components/ui/error-state";
import { DashboardOverviewClient } from "@/components/dashboard/dashboard-overview";
import { isAppError } from "@/lib/errors/app-error";
import {
  DEFAULT_DASHBOARD_DATE_BASIS,
  DEFAULT_DASHBOARD_PERIOD,
  parseDashboardDateBasis,
  parseDashboardPeriod,
} from "@/lib/dashboard/time-range";
import { requireSession } from "@/server/auth/session";
import { getDashboardOverview } from "@/server/repositories/dashboardRepository";

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const session = await requireSession();
  const params = searchParams ? await searchParams : {};
  const period =
    parseDashboardPeriod(params.period ?? params.range) ||
    DEFAULT_DASHBOARD_PERIOD;
  const dateBasis =
    parseDashboardDateBasis(params.dateBasis) || DEFAULT_DASHBOARD_DATE_BASIS;

  try {
    const data = await getDashboardOverview({
      period,
      dateBasis,
      companyId: session.user.companyId ?? null,
    });

    return <DashboardOverviewClient data={data} />;
  } catch (error) {
    const correlationId = isAppError(error) ? error.correlationId : undefined;
    const message =
      error instanceof Error
        ? error.message
        : "Dashboard data could not be loaded.";
    return (
      <div className="space-y-4">
        <div>
          <h1 className="page-title">Executive Dashboard</h1>
          <p className="text-sm text-text-secondary">
            Portfolio health for leadership — pipeline, execution &amp; financial
            exposure
          </p>
        </div>
        <ErrorState
          title="Unable to load dashboard"
          message={message}
          correlationId={correlationId}
        />
      </div>
    );
  }
}
