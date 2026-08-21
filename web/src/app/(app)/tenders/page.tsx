import { TenderStatsCards } from "@/components/tenders/tender-stats-cards";
import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getTenderListStatusCounts } from "@/server/repositories/analyticsRepository";
import {
  getTenderExplorerFacets,
  countVisibleTenders,
} from "@/server/repositories/tenderRepository";

import { TenderExplorer, TenderExplorerSkeleton } from "./tender-explorer";

export default async function TendersPage() {
  const session = await requireSession();

  const [facets, allCount, counts] = await Promise.all([
    getTenderExplorerFacets().catch(() => ({
      categories: [],
      portals: ["TENDER247", "BIDASSIST"] as Array<
        "TENDER247" | "BIDASSIST" | "MANUAL"
      >,
      cities: [],
    })),
    countVisibleTenders().catch(() => 0),
    getTenderListStatusCounts().catch(() => null),
  ]);

  return (
    <TenderExplorer
      allCount={allCount}
      categories={facets.categories}
      portals={facets.portals}
      cities={facets.cities}
      canImport={sessionHasPermission(session, "tenders.import")}
      canCreate={sessionHasPermission(session, "tenders.edit")}
      stats={counts ? <TenderStatsCards counts={counts} /> : null}
    />
  );
}

export { TenderExplorerSkeleton };
