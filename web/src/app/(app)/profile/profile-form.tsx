"use client";

import type { SafeAgentTenderUser } from "@/server/auth/safe-user";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * TF-14: profile details are read-only. Name/email are not edited here —
 * password changes go through Change Password; admins manage name via Users.
 */
export function ProfileForm({ user }: { user: SafeAgentTenderUser }) {
  return (
    <div className="max-w-lg space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          value={user.fullName}
          disabled
          readOnly
          className="bg-background-50"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={user.email}
          disabled
          readOnly
          className="bg-background-50"
        />
        <p className="text-xs text-text-muted">
          Name and email cannot be changed from profile. Contact an
          administrator if you need updates.
        </p>
      </div>
    </div>
  );
}
