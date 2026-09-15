/**
 * Controlled status values for Won Tenders / Project Execution.
 * Stored values match database CHECK constraints (snake_case).
 * Labels are for UI only — never submit label text to the API/DB.
 */

export const EXECUTION_STATUSES = [
  "awarded",
  "in_execution",
  "on_hold",
  "completed",
  "cancelled",
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  awarded: "Awarded",
  in_execution: "In Execution",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PBG_STATUSES = [
  "pending",
  "active",
  "released",
  "expired",
  "invoked",
] as const;

export type PbgStatus = (typeof PBG_STATUSES)[number];

export const PBG_STATUS_LABELS: Record<PbgStatus, string> = {
  pending: "Pending",
  active: "Active",
  released: "Released",
  expired: "Expired",
  invoked: "Invoked",
};

export const PAYMENT_STATUSES = [
  "pending",
  "partially_received",
  "received",
  "overdue",
  "cancelled",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  partially_received: "Partially Received",
  received: "Received",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export const MILESTONE_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "delayed",
  "on_hold",
] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  delayed: "Delayed",
  on_hold: "On Hold",
};

export const HEALTH_STATUSES = [
  "on_track",
  "delayed",
  "payment_overdue",
  "completed",
] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const HEALTH_STATUS_LABELS: Record<HealthStatus, string> = {
  on_track: "On Track",
  delayed: "Delayed",
  payment_overdue: "Payment Overdue",
  completed: "Completed",
};

export const PAYMENT_MODES = [
  "bank_transfer",
  "cheque",
  "neft",
  "rtgs",
  "upi",
  "other",
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  neft: "NEFT",
  rtgs: "RTGS",
  upi: "UPI",
  other: "Other",
};

function includesValue<T extends string>(
  list: readonly T[],
  value: string,
): value is T {
  return (list as readonly string[]).includes(value);
}

export function isExecutionStatus(value: string): value is ExecutionStatus {
  return includesValue(EXECUTION_STATUSES, value);
}

export function isPbgStatus(value: string): value is PbgStatus {
  return includesValue(PBG_STATUSES, value);
}

export function isPaymentStatus(value: string): value is PaymentStatus {
  return includesValue(PAYMENT_STATUSES, value);
}

export function isMilestoneStatus(value: string): value is MilestoneStatus {
  return includesValue(MILESTONE_STATUSES, value);
}

export function isHealthStatus(value: string): value is HealthStatus {
  return includesValue(HEALTH_STATUSES, value);
}

export function isPaymentMode(value: string): value is PaymentMode {
  return includesValue(PAYMENT_MODES, value);
}

/** Normalize optional PBG status for persistence. Empty → null. */
export function normalizePbgStatus(
  value: string | null | undefined,
): PbgStatus | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!isPbgStatus(trimmed)) {
    throw new Error("Invalid status selected. Please choose a valid option.");
  }
  return trimmed;
}

/**
 * Map DB / PostgREST check-constraint failures to a user-facing message.
 * Technical details should be logged by the caller.
 */
export function friendlyWonStatusConstraintError(
  error: unknown,
): string | null {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!message) return null;
  const lower = message.toLowerCase();
  if (
    lower.includes("check constraint") ||
    lower.includes("violates check") ||
    /pbg_status|execution_status|payment.*status|milestone.*status/i.test(
      message,
    )
  ) {
    return "Invalid status selected. Please choose a valid option.";
  }
  return null;
}
