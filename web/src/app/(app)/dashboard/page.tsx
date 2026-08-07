import Link from "next/link";
import { RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import { requireSession } from "@/server/auth/session";
import { getDashboardMetrics } from "@/server/repositories/analyticsRepository";

import { DashboardChartsSection } from "./dashboard-charts-section";
import { DashboardKpiSection } from "./dashboard-kpi-section";
import { DashboardOperationalSection } from "./dashboard-operational-section";

function firstName(fullName: string): string {
  return fullName.split(" ")[0] || fullName;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

async function FreshnessChip() {
  try {
    const metrics = await getDashboardMetrics();
    if (!metrics.freshnessAt) return null;
    return (
      <Badge variant="outline" className="font-normal">
        Updated {formatRelativeTime(metrics.freshnessAt)}
      </Badge>
    );
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const session = await requireSession();

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Good ${getGreeting()}, ${firstName(session.user.fullName)}`}
        subtitle="Here is today's tender intelligence overview."
        actions={
          <>
            <FreshnessChip />
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <Link href="/dashboard">
                <RefreshCw className="size-4" />
                Refresh
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/tenders">View tenders</Link>
            </Button>
          </>
        }
      />

      <DashboardKpiSection />
      <DashboardChartsSection />
      <DashboardOperationalSection />
    </div>
  );
}
