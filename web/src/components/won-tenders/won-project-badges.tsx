import { cn } from "@/lib/utils";
import {
  WON_EXECUTION_STATUS_LABELS,
  WON_HEALTH_STATUS_LABELS,
  WON_MILESTONE_STATUS_LABELS,
  WON_PAYMENT_STATUS_LABELS,
  type WonExecutionStatus,
  type WonHealthStatus,
  type WonMilestoneStatus,
  type WonPaymentStatus,
} from "@/lib/won-projects";

const executionStyles: Record<
  WonExecutionStatus,
  { bg: string; text: string; border: string }
> = {
  awarded: {
    bg: "bg-sky-100",
    text: "text-sky-800",
    border: "border-sky-200",
  },
  in_execution: {
    bg: "bg-indigo-100",
    text: "text-indigo-800",
    border: "border-indigo-200",
  },
  on_hold: {
    bg: "bg-amber-100",
    text: "text-amber-800",
    border: "border-amber-200",
  },
  completed: {
    bg: "bg-emerald-100",
    text: "text-emerald-800",
    border: "border-emerald-200",
  },
  cancelled: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-200",
  },
};

const healthStyles: Record<
  WonHealthStatus,
  { bg: string; text: string; border: string }
> = {
  on_track: {
    bg: "bg-emerald-100",
    text: "text-emerald-800",
    border: "border-emerald-200",
  },
  delayed: {
    bg: "bg-amber-100",
    text: "text-amber-800",
    border: "border-amber-200",
  },
  payment_overdue: {
    bg: "bg-rose-100",
    text: "text-rose-800",
    border: "border-rose-200",
  },
  completed: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-200",
  },
};

const milestoneStyles: Record<
  WonMilestoneStatus,
  { bg: string; text: string }
> = {
  not_started: { bg: "bg-slate-100", text: "text-slate-700" },
  in_progress: { bg: "bg-sky-100", text: "text-sky-800" },
  completed: { bg: "bg-emerald-100", text: "text-emerald-800" },
  delayed: { bg: "bg-amber-100", text: "text-amber-800" },
  on_hold: { bg: "bg-orange-100", text: "text-orange-800" },
};

const paymentStyles: Record<WonPaymentStatus, { bg: string; text: string }> = {
  pending: { bg: "bg-slate-100", text: "text-slate-700" },
  partially_received: { bg: "bg-sky-100", text: "text-sky-800" },
  received: { bg: "bg-emerald-100", text: "text-emerald-800" },
  overdue: { bg: "bg-rose-100", text: "text-rose-800" },
  cancelled: { bg: "bg-slate-100", text: "text-slate-500" },
};

type BadgeProps = {
  className?: string;
  size?: "sm" | "md";
};

export function ExecutionStatusBadge({
  status,
  className,
  size = "sm",
}: BadgeProps & { status: WonExecutionStatus }) {
  const style = executionStyles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        style.bg,
        style.text,
        style.border,
        className,
      )}
    >
      {WON_EXECUTION_STATUS_LABELS[status]}
    </span>
  );
}

export function HealthStatusBadge({
  health,
  className,
  size = "sm",
}: BadgeProps & { health: WonHealthStatus }) {
  const style = healthStyles[health];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        style.bg,
        style.text,
        style.border,
        className,
      )}
    >
      {WON_HEALTH_STATUS_LABELS[health]}
    </span>
  );
}

export function MilestoneStatusBadge({
  status,
  className,
}: BadgeProps & { status: WonMilestoneStatus }) {
  const style = milestoneStyles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium",
        style.bg,
        style.text,
        className,
      )}
    >
      {WON_MILESTONE_STATUS_LABELS[status]}
    </span>
  );
}

export function PaymentStatusBadge({
  status,
  className,
}: BadgeProps & { status: WonPaymentStatus }) {
  const style = paymentStyles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium",
        style.bg,
        style.text,
        className,
      )}
    >
      {WON_PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}
