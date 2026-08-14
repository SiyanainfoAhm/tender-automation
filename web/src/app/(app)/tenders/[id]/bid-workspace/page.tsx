import { notFound } from "next/navigation";

import { BidWorkspaceClient } from "@/components/bid-workspace/bid-workspace-client";
import { requirePermission, sessionHasPermission } from "@/server/auth/permissions";
import { getTenderById } from "@/server/repositories/tenderRepository";
import {
  getOrCreateWorkspace,
  loadBidWorkspace,
} from "@/server/repositories/bidWorkspaceRepository";
import { insertTenderActivity } from "@/server/repositories/tenderActivityRepository";
import { loadTenderDetail } from "@/server/tenders/load-tender-detail";

type BidWorkspacePageProps = {
  params: Promise<{ id: string }>;
};

export default async function BidWorkspacePage({
  params,
}: BidWorkspacePageProps) {
  const session = await requirePermission("bids.view");
  const { id } = await params;
  const tender = await loadTenderDetail({
    tenderId: id,
    companyId: session.companyId,
  });
  if (!tender) notFound();

  const created = await getOrCreateWorkspace({
    tenderId: id,
    companyId: session.companyId,
    userId: session.user.id,
    missingDocuments: tender.qualification?.missingDocuments ?? [],
  });
  if (created.created) {
    await insertTenderActivity({
      tenderId: id,
      companyId: session.companyId,
      eventType: "workspace_created",
      summary: "Bid workspace opened",
      actorUserId: session.user.id,
    });
  }

  const raw = await getTenderById(id);
  let workspace;
  try {
    workspace = await loadBidWorkspace({
      workspaceId: created.workspaceId,
      companyId: session.companyId,
      qualification: raw?.qualification ?? null,
    });
  } catch (error) {
    console.error("[bid-workspace] load failed", error);
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-foreground-600">
        Workspace failed to load. Please try again.
      </div>
    );
  }
  if (!workspace) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-foreground-600">
        Workspace failed to load.
      </div>
    );
  }

  const refreshed = created.created
    ? await loadTenderDetail({
        tenderId: id,
        companyId: session.companyId,
      })
    : tender;

  return (
    <BidWorkspaceClient
      tender={refreshed ?? tender}
      workspace={workspace}
      canEdit={sessionHasPermission(session, "bids.edit")}
      canSubmit={sessionHasPermission(session, "bids.submit")}
    />
  );
}
