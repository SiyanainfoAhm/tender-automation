import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { WonProjectDetailClient } from "@/components/won-tenders/won-project-detail-client";
import {
  requirePermission,
  sessionHasPermission,
} from "@/server/auth/permissions";
import { getWonProjectDetail } from "@/server/repositories/wonProjectRepository";
import { listUsers } from "@/server/repositories/userRepository";

type WonProjectDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function WonProjectDetailPage({
  params,
}: WonProjectDetailPageProps) {
  const session = await requirePermission("tenders.view");
  const { id } = await params;
  const companyId = session.companyId;

  if (!companyId) notFound();

  const [project, members] = await Promise.all([
    getWonProjectDetail(id, companyId),
    listUsers({ companyId }),
  ]);

  if (!project) notFound();

  const teamMembers = members
    .filter((m) => m.isActive)
    .map((m) => ({
      id: m.id,
      fullName: m.fullName || m.email,
    }));

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link
          href="/won-tenders"
          className="text-foreground-500 hover:text-foreground-800"
        >
          Won Tenders
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-foreground-400" />
        <span className="truncate font-medium text-foreground-900">
          {project.projectCode}
        </span>
      </div>

      <WonProjectDetailClient
        project={project}
        teamMembers={teamMembers}
        canEdit={sessionHasPermission(session, "tenders.edit")}
      />
    </div>
  );
}
