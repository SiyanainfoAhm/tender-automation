"use client";

import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate, formatRelativeTime } from "@/lib/format";
import type { UserRole } from "@/lib/validations";
import { MemberAvatar } from "./member-avatar";
import { RoleBadge } from "./role-badge";
import { UserStatusBadge } from "./user-status-badge";

type ViewUserDialogProps = {
  user: {
    fullName: string;
    email: string;
    role: UserRole;
    isActive: boolean;
    lastLoginAt: string | null;
    createdAt: string;
  };
};

export function ViewUserDialog({ user }: ViewUserDialogProps) {
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-text-muted hover:text-text-primary"
              aria-label="View member"
            >
              <Eye className="size-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>View</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Member details</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <MemberAvatar name={user.fullName} />
          <div>
            <p className="font-medium text-text-primary">{user.fullName}</p>
            <p className="text-sm text-text-muted">{user.email}</p>
          </div>
        </div>
        <dl className="grid gap-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Role</dt>
            <dd>
              <RoleBadge role={user.role} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Status</dt>
            <dd>
              <UserStatusBadge
                status={user.isActive ? "active" : "inactive"}
              />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Last active</dt>
            <dd className="text-text-secondary">
              {user.lastLoginAt
                ? formatRelativeTime(user.lastLoginAt)
                : "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Joined</dt>
            <dd className="text-text-secondary">
              {formatDate(user.createdAt)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">Assigned bids</dt>
            <dd className="text-text-secondary">—</dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
