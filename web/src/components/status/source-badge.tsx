import { cn } from "@/lib/utils";
import {
  sourceStyles,
  type TenderSource,
} from "@/components/tenders/tender-status-styles";

type SourceBadgeProps = {
  source: TenderSource;
  size?: "sm" | "md";
  className?: string;
};

export function SourceBadge({ source, size = "md", className }: SourceBadgeProps) {
  const style = sourceStyles[source];

  return (
    <span
      className={cn(
        "inline-flex items-center border font-medium tracking-wide uppercase",
        size === "sm" ? "rounded-md px-2 py-0.5 text-[10px]" : "rounded-[10px] px-2.5 py-1 text-[11px]",
        style.bg,
        style.text,
        style.border,
        className,
      )}
    >
      {style.label}
    </span>
  );
}
