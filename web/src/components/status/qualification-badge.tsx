import { cn } from "@/lib/utils";
import {
  qualificationStatusStyles,
  type QualificationStatus,
  type QualificationStatusStyle,
} from "@/components/tenders/tender-status-styles";

export type { QualificationStatus };

type StatusBadgeProps = {
  status: QualificationStatus;
  showDot?: boolean;
  size?: "sm" | "md";
  className?: string;
};

function getStatusStyle(status: QualificationStatus): QualificationStatusStyle {
  return qualificationStatusStyles[status];
}

export function StatusBadge({
  status,
  showDot = true,
  size = "md",
  className,
}: StatusBadgeProps) {
  const style = getStatusStyle(status);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border font-medium",
        size === "sm" ? "rounded-md px-2 py-0.5 text-[11px]" : "rounded-[10px] px-2.5 py-1 text-xs",
        style.bg,
        style.text,
        style.border,
        className,
      )}
    >
      {showDot ? (
        <span
          className={cn("shrink-0 rounded-full", style.dot, size === "sm" ? "size-1.5" : "size-2")}
          aria-hidden
        />
      ) : null}
      {style.label}
    </span>
  );
}

export { qualificationStatusStyles, getStatusStyle };
