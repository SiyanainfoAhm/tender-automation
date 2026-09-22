import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  qualificationStatusStyles,
  type QualificationStatus,
} from "@/components/tenders/tender-status-styles";
import { STATUS_DISPLAY_LABELS, type TenderStatus } from "@/lib/tender-status";
import { cn } from "@/lib/utils";

type QualificationStatusSelectProps = {
  value: TenderStatus;
  statuses: readonly TenderStatus[];
  onValueChange: (status: TenderStatus) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

/** Shared colored selector for changing a tender qualification status. */
export function QualificationStatusSelect({
  value,
  statuses,
  onValueChange,
  disabled = false,
  className,
  ariaLabel = "Update qualification status",
}: QualificationStatusSelectProps) {
  const selectedStyle = qualificationStatusStyles[value as QualificationStatus];

  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as TenderStatus)}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn(
          "h-9 text-sm",
          selectedStyle ? cn(selectedStyle.bg, selectedStyle.text) : "bg-slate-100 text-slate-700",
          className,
        )}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder="Set status" />
      </SelectTrigger>
      <SelectContent>
        {statuses.map((status) => {
          const style = qualificationStatusStyles[status as QualificationStatus];
          return (
            <SelectItem key={status} value={status}>
              <span className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", style?.dot)} />
                {STATUS_DISPLAY_LABELS[status]}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
