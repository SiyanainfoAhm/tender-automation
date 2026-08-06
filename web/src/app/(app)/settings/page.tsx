import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/server/auth/session";
import { getUserPreferences } from "@/server/repositories/savedViewRepository";

import { PreferencesForm } from "./preferences-form";

export default async function SettingsPage() {
  const session = await requireSession();
  const preferences = await getUserPreferences(session.user.id);

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
    </div>
  );
}
