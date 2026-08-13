"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ROLE_META } from "@/lib/rbac/permissions";
import { USER_ROLES, type UserRole } from "@/lib/validations";
import { updateCompanyMemberAction } from "@/server/actions/team";

type EditUserDialogProps = {
  user: {
    id: string;
    fullName: string;
    email: string;
    role: UserRole;
    isActive: boolean;
  };
  canManageRoles: boolean;
};

export function EditUserDialog({ user, canManageRoles }: EditUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.isActive ? "true" : "false");
  const [state, formAction, pending] = useActionState(
    updateCompanyMemberAction,
    {},
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state?.ok]);

  useEffect(() => {
    if (open) {
      setRole(user.role);
      setStatus(user.isActive ? "true" : "false");
    }
  }, [open, user.role, user.isActive]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-text-muted hover:text-text-primary"
              aria-label="Edit member"
            >
              <Pencil className="size-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit team member</DialogTitle>
          <DialogDescription>
            Update role or membership status for {user.fullName}.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="userId" value={user.id} />
          <div className="space-y-2">
            <Label htmlFor={`name-${user.id}`}>Full name</Label>
            <Input
              id={`name-${user.id}`}
              name="fullName"
              defaultValue={user.fullName}
              disabled={pending}
              className="h-9 rounded-md"
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              value={user.email}
              disabled
              className="h-9 rounded-md bg-surface-muted"
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <input type="hidden" name="role" value={role} />
            <Select
              value={role}
              onValueChange={(v) => setRole(v as UserRole)}
              disabled={pending || !canManageRoles}
            >
              <SelectTrigger className="h-9 rounded-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_META.find((m) => m.key === r)?.name || r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <input type="hidden" name="isActive" value={status} />
            <Select value={status} onValueChange={setStatus} disabled={pending}>
              <SelectTrigger className="h-9 rounded-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {state?.error ? (
            <p className="text-sm text-red-600">{state.error}</p>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
