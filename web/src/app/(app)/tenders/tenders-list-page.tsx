import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getTenderListStatusCounts } from "@/server/repositories/analyticsRepository";
import { getTenderExplorerFacets } from "@/server/repositories/tenderRepository";
import { tenderFiltersSchema } from "@/lib/validations";
import {
  searchParamsForStatusCounts,
  tenderStatusCountQueryKey,
} from "@/lib/tender-status-count-params";

import { TenderExplorer, TenderExplorerSkeleton } from "./tender-explorer";

export type TenderListRegion = "INDIAN" | "GLOBAL";

type TendersListPageProps = {
  region: TenderListRegion;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function withLockedRegion(
  raw: Record<string, string | string[] | undefined>,
  region: TenderListRegion,
): Record<string, string | string[] | undefined> {
  return { ...raw, region };
}

export async function TendersListPage({
  region,
  searchParams,
}: TendersListPageProps) {
  const session = await requireSession();
  const rawParams = searchParams ? await searchParams : {};
  const scopedRaw = withLockedRegion(rawParams, region);
  const statusCountFilters = tenderFiltersSchema.parse(
    searchParamsForStatusCounts(scopedRaw),
  );
  const statusCountsFilterKey = tenderStatusCountQueryKey(scopedRaw);

  const [facets, counts] = await Promise.all([
    getTenderExplorerFacets().catch(() => ({
      categories: [],
      portals: ["TENDER247", "BIDASSIST"] as Array<
        "TENDER247" | "BIDASSIST" | "MANUAL"
      >,
      cities: [],
    })),
    getTenderListStatusCounts(statusCountFilters).catch((error) => {
      console.error("[tenders] failed to load status card counts", error);
      return null;
    }),
  ]);

  return (
    <TenderExplorer
      categories={facets.categories}
      portals={facets.portals}
      cities={facets.cities}
      canImport={sessionHasPermission(session, "tenders.import")}
      canCreate={sessionHasPermission(session, "tenders.edit")}
      statusCounts={counts}
      statusCountsFilterKey={statusCountsFilterKey}
      lockedRegion={region}
    />
  );
}

export { TenderExplorerSkeleton };
