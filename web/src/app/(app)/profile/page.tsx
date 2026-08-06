import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatRelativeTime } from "@/lib/format";
import { listUserSessions } from "@/server/repositories/sessionRepository";
import { getUserById } from "@/server/repositories/userRepository";
import { getUserPreferences } from "@/server/repositories/savedViewRepository";
import { requireSession } from "@/server/auth/session";
import {
  revokeOwnSessionAction,
  revokeOtherSessionsAction,
} from "@/server/actions/auth";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

import { ProfileForm } from "./profile-form";
import { saveProfilePreferencesAction } from "./preferences-action";

export default async function ProfilePage() {
  const session = await requireSession();
  const user = await getUserById(session.user.id);
  if (!user) {
    throw new Error("User not found");
  }

  const sessions = await listUserSessions(session.user.id);
  const preferences = await getUserPreferences(session.user.id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary">
          Profile
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage your account, security and preferences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-text-muted">Role</dt>
              <dd className="mt-1 font-medium text-text-primary">{user.role}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Account status</dt>
              <dd className="mt-1">
                <Badge variant={user.isActive ? "success" : "destructive"}>
                  {user.isActive ? "Active" : "Inactive"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Last login</dt>
              <dd className="mt-1 text-text-primary">
                {user.lastLoginAt
                  ? formatRelativeTime(user.lastLoginAt)
                  : "Never"}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Password changed</dt>
              <dd className="mt-1 text-text-primary">
                {user.passwordChangedAt
                  ? formatDate(user.passwordChangedAt)
                  : "—"}
              </dd>
            </div>
          </dl>
          <ProfileForm user={user} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Active sessions</CardTitle>
          <form action={revokeOtherSessionsAction}>
            <Button type="submit" variant="outline" size="sm">
              Revoke other sessions
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-text-muted">No sessions found.</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => {
                const isCurrent = s.id === session.sessionId;
                const isRevoked = Boolean(s.revokedAt);
                return (
                  <div
                    key={s.id}
                    className="flex flex-col gap-2 rounded-[10px] border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-text-primary">
                          {s.userAgent?.slice(0, 80) ?? "Unknown device"}
                        </p>
                        {isCurrent ? (
                          <Badge variant="secondary">Current</Badge>
                        ) : null}
                        {isRevoked ? (
                          <Badge variant="destructive">Revoked</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        {s.ipAddress ?? "Unknown IP"} · Created{" "}
                        {formatDate(s.createdAt)} · Expires{" "}
                        {formatDate(s.expiresAt)} · Last seen{" "}
                        {formatRelativeTime(s.lastSeenAt)}
                      </p>
                    </div>
                    {!isCurrent && !isRevoked ? (
                      <form action={revokeOwnSessionAction.bind(null, s.id)}>
                        <Button type="submit" variant="outline" size="sm">
                          Revoke
                        </Button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveProfilePreferencesAction} className="grid max-w-md gap-4">
            <div className="space-y-2">
              <label htmlFor="theme" className="text-sm font-medium">
                Theme
              </label>
              <select
                id="theme"
                name="theme"
                defaultValue={preferences.theme}
                className="flex h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-sm"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="tableDensity" className="text-sm font-medium">
                Table density
              </label>
              <select
                id="tableDensity"
                name="tableDensity"
                defaultValue={preferences.tableDensity}
                className="flex h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-sm"
              >
                <option value="compact">Compact</option>
                <option value="comfortable">Comfortable</option>
                <option value="spacious">Spacious</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="sidebarCollapsed"
                value="true"
                defaultChecked={preferences.sidebarCollapsed}
              />
              Collapsed sidebar by default
            </label>
            <Button type="submit" size="sm" className="w-fit">
              Save preferences
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
