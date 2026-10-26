import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { ChecklistCategoryManager } from "@/components/bid-workspace/checklist-category-manager";
import { requirePermission } from "@/server/auth/permissions";
import { getTenderById } from "@/server/repositories/tenderRepository";
import { getOrCreateWorkspace, loadBidWorkspace } from "@/server/repositories/bidWorkspaceRepository";
import { loadChecklistForWorkspace } from "@/server/repositories/bidChecklistRepository";
import { loadTenderDetailSafe } from "@/server/tenders/load-tender-detail";

export const dynamic = "force-dynamic";

export default async function OrganizeChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePermission("bids.view");
  const { id } = await params;

  const loaded = await loadTenderDetailSafe({
    tenderId: id,
    companyId: session.companyId,
    userId: session.user.id,
    role: session.user.role,
    sessionExpiresAt: session.expiresAt,
  });
  if (!loaded.ok) notFound();

  const created = await getOrCreateWorkspace({
    tenderId: id,
    companyId: session.companyId,
    userId: session.user.id,
    missingDocuments: loaded.tender.qualification?.missingDocuments ?? [],
  });

  const raw = await getTenderById(id).catch(() => null);
  const workspace = await loadBidWorkspace({
    workspaceId: created.workspaceId,
    companyId: session.companyId,
    qualification: raw?.qualification ?? null,
  });
  if (!workspace) notFound();

  const checklist = await loadChecklistForWorkspace({
    workspace,
    companyId: session.companyId,
    missingDocuments: loaded.tender.qualification?.missingDocuments ?? [],
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/tenders/${id}/bid-workspace`}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
          >
            <ChevronLeft className="size-4" />
            Back to Bid Workspace
          </Link>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">Organize Checklist</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Decide how each requirement should be completed. Move it to Company Docs, AI Draft, or Manual without losing linked documents or completion history.
          </p>
        </div>
      </div>

      <ChecklistCategoryManager tenderId={id} items={checklist.items} />
    </div>
  );
}
