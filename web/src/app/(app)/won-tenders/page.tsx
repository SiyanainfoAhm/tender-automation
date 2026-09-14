import { WonTendersClient } from "@/components/won-tenders/won-tenders-client";
import { requirePermission } from "@/server/auth/permissions";
import {
  listWonProjects,
  summarizeWonProjects,
} from "@/server/repositories/wonProjectRepository";
import { listUsers } from "@/server/repositories/userRepository";

export default async function WonTendersPage() {
  const session = await requirePermission("tenders.view");
  const companyId = session.companyId;

  if (!companyId) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-foreground-500">
        Your account is not linked to a company, so won tenders cannot be loaded.
      </div>
    );
  }

  try {
    const [projects, members] = await Promise.all([
      listWonProjects(companyId),
      listUsers({ companyId }),
    ]);

    const summary = summarizeWonProjects(projects);
    const teamMembers = members
      .filter((m) => m.isActive)
      .map((m) => ({
        id: m.id,
        fullName: m.fullName || m.email,
      }));

    return (
      <WonTendersClient
        projects={projects}
        summary={summary}
        teamMembers={teamMembers}
      />
    );
  } catch (error) {
    return (
      <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        <p className="font-medium">Unable to load won tenders</p>
        <p>
          {error instanceof Error
            ? error.message
            : "An unexpected error occurred."}
        </p>
      </div>
    );
  }
}
