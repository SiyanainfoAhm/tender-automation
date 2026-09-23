import { sessionHasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { getTenderListStatusCounts } from "@/server/repositories/analyticsRepository";
import { getTenderExplorerFacets } from "@/server/repositories/tenderRepository";
import { listUsers } from "@/server/repositories/userRepository";
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

/**
 * URLs are user-controlled and can also be restored from an older browser
 * session. A retired filter value must not make this Server Component throw.
 */
function parseTenderFiltersForPage(
  raw: Record<string, string | string[] | undefined>,
  region: TenderListRegion,
) {
  const input = searchParamsForStatusCounts(withLockedRegion(raw, region));
  const parsed = tenderFiltersSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  console.warn("[tenders] invalid list filters; using defaults", {
    route: `/tenders/${region.toLowerCase()}`,
    invalidFields: parsed.error.issues.map((issue) => issue.path.join(".")),
  });
  return tenderFiltersSchema.parse({ region });
}

export async function TendersListPage({
  region,
  searchParams,
}: TendersListPageProps) {
  const session = await requireSession();
  const rawParams = searchParams ? await searchParams : {};
  const scopedRaw = withLockedRegion(rawParams, region);
  const statusCountFilters = parseTenderFiltersForPage(rawParams, region);
  const statusCountsFilterKey = tenderStatusCountQueryKey(scopedRaw);

  const [facets, counts, members] = await Promise.all([
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
    session.user.companyId
      ? listUsers({ companyId: session.user.companyId }).catch(() => [])
      : Promise.resolve([]),
  ]);
  const teamMembers = members
    .filter((member) => member.isActive)
    .map((member) => ({ id: member.id, fullName: member.fullName || member.email }));

  return (
    <TenderExplorer
      cities={facets.cities}
      canImport={sessionHasPermission(session, "tenders.import")}
      canCreate={sessionHasPermission(session, "tenders.edit")}
      canEdit={sessionHasPermission(session, "tenders.edit")}
      teamMembers={teamMembers}
      statusCounts={counts}
      statusCountsFilterKey={statusCountsFilterKey}
      lockedRegion={region}
    />
  );
}

export { TenderExplorerSkeleton };
