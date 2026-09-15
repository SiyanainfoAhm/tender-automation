/**
 * Single source of truth for Won Tenders / Project Execution statuses.
 * Values MUST match public.agenttender_won_projects CHECK constraints:
 *
 * execution_status IN (
 *   'awarded', 'in_execution', 'on_hold', 'completed', 'cancelled'
 * )
 * pbg_status IS NULL OR IN (
 *   'pending', 'active', 'released', 'expired', 'invoked'
 * )
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

/** Dropdown options: value = DB, label = UI. */
export const EXECUTION_STATUS_OPTIONS = EXECUTION_STATUSES.map((value) => ({
  value,
  label: EXECUTION_STATUS_LABELS[value],
}));

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

export const PBG_STATUS_OPTIONS = PBG_STATUSES.map((value) => ({
  value,
  label: PBG_STATUS_LABELS[value],
}));

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

export const PAYMENT_STATUS_OPTIONS = PAYMENT_STATUSES.map((value) => ({
  value,
  label: PAYMENT_STATUS_LABELS[value],
}));

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

export const MILESTONE_STATUS_OPTIONS = MILESTONE_STATUSES.map((value) => ({
  value,
  label: MILESTONE_STATUS_LABELS[value],
}));

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

export const HEALTH_STATUS_OPTIONS = HEALTH_STATUSES.map((value) => ({
  value,
  label: HEALTH_STATUS_LABELS[value],
}));

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

export const PAYMENT_MODE_OPTIONS = PAYMENT_MODES.map((value) => ({
  value,
  label: PAYMENT_MODE_LABELS[value],
}));

function includesValue<T extends string>(
  list: readonly T[],
  value: string,
): value is T {
  return (list as readonly string[]).includes(value);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
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

/**
 * Accept DB value or UI label and return the exact DB value.
 * Examples: "awarded" | "Awarded" | "IN_EXECUTION" | "In Execution" → DB token.
 */
export function parseExecutionStatus(
  input: string | null | undefined,
): ExecutionStatus | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (isExecutionStatus(raw)) return raw;
  const token = normalizeToken(raw);
  if (isExecutionStatus(token)) return token;
  const byLabel = EXECUTION_STATUSES.find(
    (status) =>
      EXECUTION_STATUS_LABELS[status].toLowerCase() === raw.toLowerCase(),
  );
  return byLabel ?? null;
}

export function parsePbgStatus(
  input: string | null | undefined,
): PbgStatus | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (isPbgStatus(raw)) return raw;
  const token = normalizeToken(raw);
  if (isPbgStatus(token)) return token;
  const byLabel = PBG_STATUSES.find(
    (status) => PBG_STATUS_LABELS[status].toLowerCase() === raw.toLowerCase(),
  );
  return byLabel ?? null;
}

/** Normalize optional PBG status for persistence. Empty → null. */
export function normalizePbgStatus(
  value: string | null | undefined,
): PbgStatus | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = parsePbgStatus(trimmed);
  if (!parsed) {
    throw new Error("Please select a valid status.");
  }
  return parsed;
}

/**
 * Map only real status CHECK failures to a user-facing message.
 * Do not treat unrelated check constraints / column mentions as status errors.
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
  const isStatusConstraint =
    lower.includes("execution_status_check") ||
    lower.includes("pbg_status_check") ||
    (lower.includes("won_project_milestones") && lower.includes("status")) ||
    (lower.includes("won_project_payments") && lower.includes("status"));
  if (
    isStatusConstraint ||
    ((lower.includes("violates check") || lower.includes("check constraint")) &&
      (lower.includes("execution_status") || lower.includes("pbg_status")))
  ) {
    return "Please select a valid status.";
  }
  return null;
}
