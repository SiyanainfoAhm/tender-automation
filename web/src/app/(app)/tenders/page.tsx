import { Suspense } from "react";
import { Clock, FileText, Target, TrendingUp, Wallet } from "lucide-react";

import { CompactKpiCard } from "@/components/tenders/compact-kpi-card";
import { TenderPageActions } from "@/components/tenders/tender-page-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { formatIndianCurrency } from "@/lib/format";
import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getTenderManagementKpis } from "@/server/repositories/analyticsRepository";
import {
  getTenderExplorerFacets,
  countVisibleTenders,
} from "@/server/repositories/tenderRepository";

import { TenderExplorer, TenderExplorerSkeleton } from "./tender-explorer";

async function TenderManagementStats() {
  try {
    const kpis = await getTenderManagementKpis();
    const cards = [
      {
        label: "Total Tenders",
        value: kpis.totalTenders.toLocaleString("en-IN"),
        icon: FileText,
        iconClassName: "bg-sky-100 text-sky-700",
      },
      {
        label: "Active Pipeline",
        value: kpis.activePipeline.toLocaleString("en-IN"),
        icon: TrendingUp,
        iconClassName: "bg-violet-100 text-violet-700",
      },
      {
        label: "Will Bid",
        value: kpis.willBid.toLocaleString("en-IN"),
        icon: Target,
        iconClassName: "bg-emerald-100 text-emerald-700",
      },
      {
        label: "Closing Soon",
        value: kpis.closingSoon.toLocaleString("en-IN"),
        icon: Clock,
        iconClassName: "bg-rose-100 text-rose-700",
      },
      {
        label: "Pipeline Value",
        value: formatIndianCurrency(kpis.pipelineValue),
        icon: Wallet,
        iconClassName: "bg-amber-100 text-amber-700",
      },
    ];

    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <CompactKpiCard key={card.label} {...card} />
        ))}
      </div>
    );
  } catch {
    return null;
  }
}

function TenderManagementStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="rounded-lg border border-border bg-card p-4 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function TendersPage() {
  const session = await requireSession();

  const [facets, allCount] = await Promise.all([
    getTenderExplorerFacets().catch(() => ({
      categories: [],
      portals: ["TENDER247", "BIDASSIST"] as Array<"TENDER247" | "BIDASSIST">,
    })),
    countVisibleTenders().catch(() => 0),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="section-title">Tender Management</h1>
          <p className="mt-0.5 text-sm text-foreground-500">
            Import, screen and track tenders from all your connected portals
          </p>
        </div>
        <TenderPageActions
          canImport={sessionHasPermission(session, "tenders.import")}
        />
      </div>

      <Suspense fallback={<TenderManagementStatsSkeleton />}>
        <TenderManagementStats />
      </Suspense>

      <TenderExplorer
        allCount={allCount}
        categories={facets.categories}
        portals={facets.portals}
      />
    </div>
  );
}

export { TenderExplorerSkeleton };
