"use client";

import Link from "next/link";
import {
  Eye,
  KeyRound,
  MoreHorizontal,
  ShieldOff,
  UserCog,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type UserActionsMenuProps = {
  userId: string;
};

export function UserActionsMenu({ userId }: UserActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="User actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href={`/users/${userId}`}>
            <Eye className="size-4" />
            View account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/users/${userId}`}>
            <UserCog className="size-4" />
            Edit
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/users/${userId}#security`}>
            <KeyRound className="size-4" />
            Reset password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-status-nogo" disabled>
          <ShieldOff className="size-4" />
          Disable (on detail page)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
