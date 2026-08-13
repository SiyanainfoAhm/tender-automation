import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { tenderFiltersSchema } from "@/lib/validations";
import { requireSession } from "@/server/auth/session";
import { getDashboardMetrics } from "@/server/repositories/analyticsRepository";
import { listTenders } from "@/server/repositories/tenderRepository";
import {
  Clock,
  FileText,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { TenderExplorer, TenderExplorerSkeleton } from "./tender-explorer";

function flattenSearchParams(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? (value[0] ?? "") : value;
  }
  return out;
}

type TendersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function TenderManagementStats() {
  try {
    const metrics = await getDashboardMetrics();
    const activePipeline =
      metrics.goOpportunities +
      metrics.pendingVerification +
      (metrics.byStatus.CONDITIONAL_GO || 0) +
      (metrics.byStatus.PARTNER_BID || 0);
    const willBid = metrics.goOpportunities;

    const cards = [
      {
        label: "Total Tenders",
        value: metrics.totalTenders.toLocaleString("en-IN"),
        hint: "All sources",
        icon: FileText,
        variant: "total" as const,
      },
      {
        label: "Active Pipeline",
        value: activePipeline.toLocaleString("en-IN"),
        hint: "GO + VERIFY + related",
        icon: TrendingUp,
        variant: "new" as const,
      },
      {
        label: "Will Bid",
        value: willBid.toLocaleString("en-IN"),
        hint: "Mapped from qualification GO",
        icon: Target,
        variant: "go" as const,
      },
      {
        label: "Closing Soon",
        value: metrics.closingWithin3Days.toLocaleString("en-IN"),
        hint: "Within 3 days",
        icon: Clock,
        variant: "closing" as const,
      },
      {
        label: "Pending Review",
        value: metrics.pendingVerification.toLocaleString("en-IN"),
        hint: "Status VERIFY",
        icon: Wallet,
        variant: "verify" as const,
      },
    ];

    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>
    );
  } catch {
    return null;
  }
}

export default async function TendersPage({ searchParams }: TendersPageProps) {
  await requireSession();
  const raw = flattenSearchParams(await searchParams);
  const filters = tenderFiltersSchema.parse(raw);

  const { rows, total } = await listTenders(filters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tender Management"
        subtitle="Import, screen and track tenders from all your connected portals"
      />

      <Suspense fallback={null}>
        <TenderManagementStats />
      </Suspense>

      <Suspense fallback={<TenderExplorerSkeleton />}>
        <TenderExplorer rows={rows} total={total} filters={filters} />
      </Suspense>
    </div>
  );
}
