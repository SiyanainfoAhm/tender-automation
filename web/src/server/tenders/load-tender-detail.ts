import "server-only";

import { getTenderById } from "@/server/repositories/tenderRepository";
import {
  derivedTenderLifecycleEvents,
  listTenderActivity,
} from "@/server/repositories/tenderActivityRepository";
import { getWorkspaceSummary } from "@/server/repositories/bidWorkspaceRepository";
import { mapTenderDetail } from "@/server/tenders/map-tender-detail";
import type { TenderDetailDTO } from "@/lib/tender-detail";

/** Shared loader for Tender Detail, AI Analysis, and Bid Workspace. */
export async function loadTenderDetail(options: {
  tenderId: string;
  companyId?: string | null;
}): Promise<TenderDetailDTO | null> {
  const data = await getTenderById(options.tenderId);
  if (!data) return null;

  const workspace = options.companyId
    ? await getWorkspaceSummary({
        tenderId: options.tenderId,
        companyId: options.companyId,
      })
    : null;

  const storedActivity = await listTenderActivity({
    tenderId: options.tenderId,
    companyId: options.companyId,
  });
  const derived = derivedTenderLifecycleEvents({
    tenderId: options.tenderId,
    firstSeenAt:
      typeof data.tender.first_seen_at === "string"
        ? data.tender.first_seen_at
        : null,
    crawledAt:
      typeof data.tender.crawled_at === "string" ? data.tender.crawled_at : null,
    qualifiedAt:
      typeof data.qualification?.qualified_at === "string"
        ? data.qualification.qualified_at
        : null,
  });

  const seen = new Set<string>();
  const activity = [...storedActivity, ...derived]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });

  return mapTenderDetail({
    tender: data.tender,
    qualification: data.qualification,
    submitted: workspace?.submissionStatus === "submitted",
    workspaceId: workspace?.id ?? null,
    activity,
  });
}
