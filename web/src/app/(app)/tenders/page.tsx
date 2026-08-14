import { Suspense } from "react";
import { Clock, FileText, Target, TrendingUp, Wallet } from "lucide-react";

import { CompactKpiCard } from "@/components/tenders/compact-kpi-card";
import { TenderPageActions } from "@/components/tenders/tender-page-actions";
import { formatIndianCurrency } from "@/lib/format";
import { tenderFiltersSchema } from "@/lib/validations";
import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getTenderManagementKpis } from "@/server/repositories/analyticsRepository";
import {
  getTenderExplorerFacets,
  listTenders,
  countVisibleTenders,
} from "@/server/repositories/tenderRepository";

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

export default async function TendersPage({ searchParams }: TendersPageProps) {
  const session = await requireSession();
  const raw = flattenSearchParams(await searchParams);
  const filters = tenderFiltersSchema.parse(raw);

  const [{ rows, total }, facets, allCount] = await Promise.all([
    listTenders(filters),
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
          rows={rows}
          page={filters.page}
          canImport={sessionHasPermission(session, "tenders.import")}
        />
      </div>

      <Suspense fallback={null}>
        <TenderManagementStats />
      </Suspense>

      <Suspense fallback={<TenderExplorerSkeleton />}>
        <TenderExplorer
          rows={rows}
          total={total}
          allCount={allCount || total}
          filters={filters}
          categories={facets.categories}
          portals={facets.portals}
        />
      </Suspense>
    </div>
  );
}
