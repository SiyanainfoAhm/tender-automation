import {
  confidenceToPercent,
  matchScoreClass,
  matchScoreTextClass,
} from "@/lib/tender-deadline";
import { cn } from "@/lib/utils";

export function MatchScore({
  confidence,
}: {
  confidence: number | null | undefined;
}) {
  const percent = confidenceToPercent(confidence);
  if (percent == null) {
    return <span className="text-sm text-foreground-400">—</span>;
  }

  return (
    <div className="flex min-w-[72px] items-center gap-2">
      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-background-200">
        <div
          className={cn("h-full rounded-full", matchScoreClass(percent))}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span
        className={cn(
          "text-xs font-semibold tabular-nums",
          matchScoreTextClass(percent),
        )}
      >
        {percent}%
      </span>
    </div>
  );
}
