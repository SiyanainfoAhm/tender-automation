import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  KeyRound,
  Shield,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { RoleBadge } from "@/components/users/role-badge";
import { UserStatusBadge } from "@/components/users/user-status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatRelativeTime } from "@/lib/format";
import { requirePermission } from "@/server/auth/permissions";
import {
  revokeAllSessionsAction,
  unlockUserAction,
} from "@/server/actions/auth";
import { getUserById } from "@/server/repositories/userRepository";

import { UserDetailForms } from "./user-detail-forms";

type UserDetailPageProps = {
  params: Promise<{ id: string }>;
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const session = await requirePermission("users.view");
  const { id } = await params;
  const user = await getUserById(id);
  if (!user || user.companyId !== session.companyId) notFound();

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 gap-1.5">
        <Link href="/users">
          <ArrowLeft className="size-4" />
          Back to users
        </Link>
      </Button>

      <PageHeader
        title={user.fullName}
        subtitle={user.email}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RoleBadge role={user.role} />
            <UserStatusBadge
              status={user.isActive ? "active" : "inactive"}
            />
          </div>
        }
      />

      <div className="flex items-center gap-4 rounded-[14px] border border-border bg-surface p-5 shadow-sm">
        <Avatar className="size-14">
          <AvatarFallback className="bg-primary-muted text-lg font-semibold text-primary">
            {getInitials(user.fullName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-sm text-text-secondary">{user.email}</p>
          <p className="mt-1 text-xs text-text-muted">
            User ID: {user.id}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Calendar}
          label="Last login"
          value={
            user.lastLoginAt
              ? formatRelativeTime(user.lastLoginAt)
              : "Never"
          }
        />
        <SummaryCard
          icon={Users}
          label="Account created"
          value={formatDate(user.createdAt)}
        />
        <SummaryCard
          icon={KeyRound}
          label="Password status"
          value={user.mustChangePassword ? "Change required" : "Up to date"}
        />
        <SummaryCard
          icon={Shield}
          label="Failed attempts"
          value={String(user.failedLoginAttempts)}
        />
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security" id="security">
            Security
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <UserDetailForms user={user} section="profile" />
        </TabsContent>
        <TabsContent value="security">
          <UserDetailForms user={user} section="security" />
          <div className="mt-4 flex flex-wrap gap-3">
            <form action={unlockUserAction.bind(null, user.id)}>
              <Button type="submit" variant="outline">
                Unlock account
              </Button>
            </form>
            <form action={revokeAllSessionsAction.bind(null, user.id)}>
              <Button type="submit" variant="destructive">
                Revoke all sessions
              </Button>
            </form>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex size-9 items-center justify-center rounded-[10px] bg-surface-secondary text-primary">
        <Icon className="size-4" />
      </div>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text-primary">{value}</p>
    </div>
  );
}
