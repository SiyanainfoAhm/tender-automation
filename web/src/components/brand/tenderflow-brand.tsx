import Link from "next/link";
import { Layers } from "lucide-react";

import { cn } from "@/lib/utils";

type TenderFlowBrandProps = {
  href?: string;
  className?: string;
  align?: "center" | "start";
  compact?: boolean;
};

export function TenderFlowBrand({
  href = "/login",
  className,
  align = "center",
  compact = false,
}: TenderFlowBrandProps) {
  const content = (
    <div
      className={cn(
        "flex gap-3",
        align === "center" ? "flex-col items-center text-center" : "items-center",
        className,
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md bg-primary text-white",
          compact ? "size-8" : "size-10",
        )}
      >
        <Layers className={compact ? "size-4" : "size-5"} aria-hidden />
      </div>
      <div className={cn(align === "center" && "space-y-0.5")}>
        <p
          className={cn(
            "font-heading font-semibold tracking-tight text-text-primary",
            compact ? "text-sm" : "text-lg",
          )}
        >
          TenderFlow
        </p>
        <p
          className={cn(
            "text-text-muted",
            compact ? "text-[11px]" : "text-xs",
          )}
        >
          AI-Powered Bid Management
        </p>
      </div>
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} className="inline-flex outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-md">
      {content}
    </Link>
  );
}
