import { SubmittedTendersClient } from "@/components/submitted-tenders/submitted-tenders-client";
import { requirePermission, sessionHasPermission } from "@/server/auth/permissions";
import { listSubmittedTenders } from "@/server/repositories/submittedTenderRepository";
import { listUsers } from "@/server/repositories/userRepository";

export const dynamic = "force-dynamic";

export default async function SubmittedTendersPage() {
  const session = await requirePermission("tenders.view");
  const companyId = session.companyId;

  if (!companyId) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-foreground-500">
        Your account is not linked to a company, so submitted tenders cannot be
        loaded.
      </div>
    );
  }

  try {
    const [{ items }, members] = await Promise.all([
      listSubmittedTenders(companyId),
      listUsers({ companyId }),
    ]);

    const teamMembers = members
      .filter((m) => m.isActive)
      .map((m) => ({
        id: m.id,
        fullName: m.fullName || m.email,
      }));

    return (
      <SubmittedTendersClient
        items={items}
        teamMembers={teamMembers}
        canEdit={sessionHasPermission(session, "tenders.edit")}
      />
    );
  } catch (error) {
    return (
      <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        <p className="font-medium">Unable to load submitted tenders</p>
        <p>
          {error instanceof Error
            ? error.message
            : "An unexpected error occurred."}
        </p>
      </div>
    );
  }
}
