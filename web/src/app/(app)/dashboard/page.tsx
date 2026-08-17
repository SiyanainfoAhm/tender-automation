import { ErrorState } from "@/components/ui/error-state";
import { DashboardOverviewClient } from "@/components/dashboard/dashboard-overview";
import { isAppError } from "@/lib/errors/app-error";
import {
  DEFAULT_DASHBOARD_TIME_RANGE,
  parseDashboardTimeRange,
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
  const range = parseDashboardTimeRange(params.range) || DEFAULT_DASHBOARD_TIME_RANGE;

  try {
    const data = await getDashboardOverview({
      range,
      companyId: session.user.companyId ?? null,
    });

    return <DashboardOverviewClient data={data} />;
  } catch (error) {
    const correlationId = isAppError(error) ? error.correlationId : undefined;
    const message =
      error instanceof Error ? error.message : "Dashboard data could not be loaded.";
    return (
      <div className="space-y-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm text-text-secondary">
            Overview of your tender pipeline and bid activity
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
