import { PageHeader } from "@/components/layout/page-header";
import { CreateUserDialog } from "@/components/users/create-user-dialog";
import { UserTable } from "@/components/users/user-table";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/server/auth/session";
import { listUsers } from "@/server/repositories/userRepository";
import { Users } from "lucide-react";

export default async function UsersPage() {
  await requireRole("ADMIN");
  const users = await listUsers();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users and Access"
        subtitle="Manage workspace users, roles and account security."
        actions={<CreateUserDialog />}
      />

      {users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No users yet"
          description="Create the first workspace user to get started."
          action={<CreateUserDialog />}
        />
      ) : (
        <UserTable users={users} />
      )}
    </div>
  );
}
