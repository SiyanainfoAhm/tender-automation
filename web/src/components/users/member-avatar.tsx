"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function MemberAvatar({
  name,
  imageUrl,
  className,
  size = "md",
}: {
  name: string;
  imageUrl?: string | null;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <Avatar
      className={cn(size === "sm" ? "size-8" : "size-9", className)}
    >
      {imageUrl ? <AvatarImage src={imageUrl} alt={name} /> : null}
      <AvatarFallback className="bg-emerald-50 text-xs font-semibold text-emerald-700">
        {getInitials(name || "?")}
      </AvatarFallback>
    </Avatar>
  );
}
