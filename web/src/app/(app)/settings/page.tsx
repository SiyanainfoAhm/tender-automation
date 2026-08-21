import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tender247AccountsPanel } from "@/components/settings/tender247-accounts-panel";
import { requireSession } from "@/server/auth/session";
import { sessionHasPermission } from "@/server/auth/permissions";
import { getUserPreferences } from "@/server/repositories/savedViewRepository";
import { listTender247AccountsAction } from "@/server/actions/tender247-accounts";
import { getCompanyById } from "@/server/repositories/companyRepository";

import { PreferencesForm } from "./preferences-form";

export default async function SettingsPage() {
  const session = await requireSession();
  const preferences = await getUserPreferences(session.user.id);
  const canViewAccounts = sessionHasPermission(session, "settings.view");
  const canManageAccounts =
    sessionHasPermission(session, "integrations.manage") ||
    sessionHasPermission(session, "settings.edit");

  const accounts = canViewAccounts
    ? await listTender247AccountsAction().catch(() => [])
    : [];

  const company = session.user.companyId
    ? await getCompanyById(session.user.companyId).catch(() => null)
    : null;
  const companyName =
    company?.name?.trim() || "Siyana Info Solutions Pvt. Ltd.";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Settings
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Customize your workspace appearance and defaults.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance & layout</CardTitle>
        </CardHeader>
        <CardContent>
          <PreferencesForm preferences={preferences} />
        </CardContent>
      </Card>

      {canViewAccounts ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tender247 Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <Tender247AccountsPanel
              accounts={accounts}
              canManage={canManageAccounts}
              companyName={companyName}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
