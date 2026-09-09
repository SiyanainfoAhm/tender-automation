import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getTenderListStatusCounts } from "@/server/repositories/analyticsRepository";
import {
  getTenderExplorerFacets,
  countVisibleTenders,
} from "@/server/repositories/tenderRepository";
import { tenderFiltersSchema } from "@/lib/validations";
import {
  searchParamsForStatusCounts,
  tenderStatusCountQueryKey,
} from "@/lib/tender-status-count-params";

import { TenderExplorer, TenderExplorerSkeleton } from "./tender-explorer";

type TendersPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TendersPage({ searchParams }: TendersPageProps) {
  const session = await requireSession();
  const rawParams = searchParams ? await searchParams : {};
  const statusCountFilters = tenderFiltersSchema.parse(
    searchParamsForStatusCounts(rawParams),
  );
  const statusCountsFilterKey = tenderStatusCountQueryKey(rawParams);

  const [facets, allCount, counts] = await Promise.all([
    getTenderExplorerFacets().catch(() => ({
      categories: [],
      portals: ["TENDER247", "BIDASSIST"] as Array<
        "TENDER247" | "BIDASSIST" | "MANUAL"
      >,
      cities: [],
    })),
    countVisibleTenders().catch(() => 0),
    getTenderListStatusCounts(statusCountFilters).catch((error) => {
      console.error("[tenders] failed to load status card counts", error);
      return null;
    }),
  ]);

  return (
    <TenderExplorer
      allCount={allCount}
      categories={facets.categories}
      portals={facets.portals}
      cities={facets.cities}
      canImport={sessionHasPermission(session, "tenders.import")}
      canCreate={sessionHasPermission(session, "tenders.edit")}
      statusCounts={counts}
      statusCountsFilterKey={statusCountsFilterKey}
    />
  );
}

export { TenderExplorerSkeleton };
