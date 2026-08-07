"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MoneyDisplay } from "@/lib/format-inr";

type MoneyCellProps = {
  display: MoneyDisplay;
  align?: "left" | "right";
  className?: string;
};

export function MoneyCell({
  display,
  align = "right",
  className,
}: MoneyCellProps) {
  const text = (
    <span
      className={cn(
        "block text-sm tabular-nums",
        align === "right" ? "text-right" : "text-left",
        display.isNumeric
          ? "font-medium text-text-primary"
          : "text-text-secondary",
        className,
      )}
    >
      {display.label}
    </span>
  );

  if (!display.tooltip) {
    return text;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-full cursor-default border-0 bg-transparent p-0",
              align === "right" ? "text-right" : "text-left",
            )}
          >
            {text}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {display.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type TruncateWithTooltipProps = {
  text: string | null | undefined;
  className?: string;
  empty?: string;
};

export function TruncateWithTooltip({
  text,
  className,
  empty = "—",
}: TruncateWithTooltipProps) {
  const value = text?.trim() || "";
  if (!value) {
    return <span className={cn("text-text-muted", className)}>{empty}</span>;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "block truncate text-sm text-text-secondary",
              className,
            )}
          >
            {value}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm">
          {value}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
