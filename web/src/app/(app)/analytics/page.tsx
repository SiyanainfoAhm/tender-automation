import { ErrorState } from "@/components/ui/error-state";
import { ReportsClient } from "@/components/reports/reports-client";
import { isAppError } from "@/lib/errors/app-error";
import {
  financialYearOptions,
  parseFinancialYearKey,
} from "@/lib/reports/financial-year";
import { parseReportsTab } from "@/lib/reports/types";
import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getReportsAnalytics } from "@/server/repositories/reportsRepository";

type AnalyticsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AnalyticsPage({
  searchParams,
}: AnalyticsPageProps) {
  const session = await requireSession();
  const raw = await searchParams;
  const fy = parseFinancialYearKey(raw.fy);
  const tab = parseReportsTab(raw.tab);

  try {
    const report = await getReportsAnalytics({
      companyId: session.user.companyId,
      financialYear: fy,
    });
    const canExport = sessionHasPermission(session, "reports.export");

    return (
      <ReportsClient
        report={report}
        fyOptions={financialYearOptions(6)}
        activeTab={tab}
        canExport={canExport}
      />
    );
  } catch (error) {
    const correlationId = isAppError(error) ? error.correlationId : undefined;
    return (
      <div className="space-y-4">
        <div>
          <h1 className="section-title">Reports & Analytics</h1>
          <p className="mt-1 text-sm text-foreground-500">
            Comprehensive insights into your bidding performance, pipeline
            health, and financial metrics
          </p>
        </div>
        <ErrorState
          title="Unable to load reports"
          message={
            error instanceof Error
              ? error.message
              : "Report data could not be loaded."
          }
          correlationId={correlationId}
        />
      </div>
    );
  }
}
