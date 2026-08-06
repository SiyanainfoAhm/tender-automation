import { Badge } from "@/components/ui/badge";
import type { SafeUser } from "@/server/repositories/userRepository";

type UserStatusBadgeProps = {
  user: Pick<
    SafeUser,
    "isActive" | "lockedUntil" | "mustChangePassword"
  >;
};

export function UserStatusBadge({ user }: UserStatusBadgeProps) {
  if (!user.isActive) {
    return <Badge variant="destructive">Disabled</Badge>;
  }
  if (
    user.lockedUntil &&
    new Date(user.lockedUntil).getTime() > Date.now()
  ) {
    return <Badge variant="warning">Locked</Badge>;
  }
  if (user.mustChangePassword) {
    return <Badge variant="warning">Password change required</Badge>;
  }
  return <Badge variant="success">Active</Badge>;
}
