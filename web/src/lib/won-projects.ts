/** Won Tenders / Project Execution domain types and pure helpers. */

export {
  EXECUTION_STATUSES as WON_EXECUTION_STATUSES,
  EXECUTION_STATUS_LABELS as WON_EXECUTION_STATUS_LABELS,
  EXECUTION_STATUS_OPTIONS as WON_EXECUTION_STATUS_OPTIONS,
  MILESTONE_STATUSES as WON_MILESTONE_STATUSES,
  MILESTONE_STATUS_LABELS as WON_MILESTONE_STATUS_LABELS,
  MILESTONE_STATUS_OPTIONS as WON_MILESTONE_STATUS_OPTIONS,
  PAYMENT_MODES as WON_PAYMENT_MODES,
  PAYMENT_MODE_LABELS as WON_PAYMENT_MODE_LABELS,
  PAYMENT_MODE_OPTIONS as WON_PAYMENT_MODE_OPTIONS,
  PAYMENT_STATUSES as WON_PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS as WON_PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_OPTIONS as WON_PAYMENT_STATUS_OPTIONS,
  PBG_STATUSES as WON_PBG_STATUSES,
  PBG_STATUS_LABELS as WON_PBG_STATUS_LABELS,
  PBG_STATUS_OPTIONS as WON_PBG_STATUS_OPTIONS,
  HEALTH_STATUSES as WON_HEALTH_STATUSES,
  HEALTH_STATUS_LABELS as WON_HEALTH_STATUS_LABELS,
  HEALTH_STATUS_OPTIONS as WON_HEALTH_STATUS_OPTIONS,
  parseExecutionStatus,
  parsePbgStatus,
  type ExecutionStatus as WonExecutionStatus,
  type MilestoneStatus as WonMilestoneStatus,
  type PaymentMode as WonPaymentMode,
  type PaymentStatus as WonPaymentStatus,
  type PbgStatus as WonPbgStatus,
  type HealthStatus as WonHealthStatus,
} from "@/lib/wonTenderStatuses";

import type {
  ExecutionStatus as WonExecutionStatus,
  HealthStatus as WonHealthStatus,
  MilestoneStatus as WonMilestoneStatus,
  PaymentMode as WonPaymentMode,
  PaymentStatus as WonPaymentStatus,
  PbgStatus as WonPbgStatus,
} from "@/lib/wonTenderStatuses";

export const WON_DOCUMENT_CATEGORIES = [
  "purchase_order",
  "contract",
  "letter_of_intent",
  "pbg",
  "invoice",
  "payment_receipt",
  "milestone_deliverable",
  "acceptance_certificate",
  "completion_certificate",
  "correspondence",
  "technical_document",
  "other",
] as const;

export type WonDocumentCategory = (typeof WON_DOCUMENT_CATEGORIES)[number];

export const WON_DOCUMENT_CATEGORY_LABELS: Record<WonDocumentCategory, string> =
  {
    purchase_order: "Purchase Order",
    contract: "Contract",
    letter_of_intent: "Letter of Intent",
    pbg: "PBG",
    invoice: "Invoice",
    payment_receipt: "Payment Receipt",
    milestone_deliverable: "Milestone Deliverable",
    acceptance_certificate: "Acceptance Certificate",
    completion_certificate: "Completion Certificate",
    correspondence: "Correspondence",
    technical_document: "Technical Document",
    other: "Other",
  };

export type WonProjectMilestone = {
  id: string;
  wonProjectId: string;
  title: string;
  description: string | null;
  dueDate: string;
  milestoneValue: number | null;
  paymentLinked: boolean;
  status: WonMilestoneStatus;
  ownerId: string | null;
  ownerName: string | null;
  completedAt: string | null;
  notes: string | null;
  sortOrder: number;
};

export type WonProjectPaymentReceipt = {
  id: string;
  paymentId: string;
  amount: number;
  receivedDate: string;
  paymentMode: WonPaymentMode;
  transactionReference: string | null;
  notes: string | null;
  createdAt: string;
};

export type WonProjectPayment = {
  id: string;
  wonProjectId: string;
  milestoneId: string | null;
  milestoneTitle: string | null;
  title: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: number;
  dueDate: string;
  receivedAmount: number;
  receivedDate: string | null;
  paymentMode: WonPaymentMode | null;
  transactionReference: string | null;
  status: WonPaymentStatus;
  derivedStatus: WonPaymentStatus;
  balance: number;
  notes: string | null;
  receipts: WonProjectPaymentReceipt[];
};

export type WonProjectDocument = {
  id: string;
  wonProjectId: string;
  milestoneId: string | null;
  paymentId: string | null;
  tenderDocumentId: string | null;
  title: string;
  category: WonDocumentCategory;
  fileName: string;
  originalName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  storageUrl: string | null;
  documentDate: string | null;
  description: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type WonProject = {
  id: string;
  companyId: string;
  tenderId: string;
  projectCode: string;
  executionStatus: WonExecutionStatus;
  awardDate: string;
  finalAwardValue: number;
  poNumber: string | null;
  poDate: string | null;
  contractNumber: string | null;
  contractDescription: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  clientDepartment: string | null;
  projectManagerId: string | null;
  projectManagerName: string | null;
  pbgApplicable: boolean;
  pbgNumber: string | null;
  pbgAmount: number | null;
  pbgIssueDate: string | null;
  pbgExpiryDate: string | null;
  pbgBank: string | null;
  pbgStatus: WonPbgStatus | null;
  jiraProjectKey: string | null;
  jiraUrl: string | null;
  repositoryUrl: string | null;
  deploymentUrl: string | null;
  stagingUrl: string | null;
  productionUrl: string | null;
  developmentNotes: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // Tender join fields
  tenderTitle: string;
  organization: string | null;
  location: string | null;
  portal: string | null;
  referenceNo: string | null;
  category: string | null;
  tenderValue: number | null;
};

export type WonProjectListItem = WonProject & {
  health: WonHealthStatus;
  milestonesCompleted: number;
  milestonesTotal: number;
  milestoneProgressPercent: number;
  paymentsReceived: number;
  paymentsExpected: number;
  paymentProgressPercent: number;
  overdueAmount: number;
  outstandingAmount: number;
  nextMilestoneDueDate: string | null;
};

export type WonProjectSummary = {
  totalProjects: number;
  activeExecution: number;
  completed: number;
  contractValue: number;
  paymentsReceived: number;
  paymentOverdue: number;
};

export type WonProjectDetail = WonProjectListItem & {
  milestones: WonProjectMilestone[];
  payments: WonProjectPayment[];
  documents: WonProjectDocument[];
};

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function derivePaymentStatus(options: {
  amount: number;
  receivedAmount: number;
  dueDate: string;
  explicitStatus?: string | null;
  today?: string;
}): WonPaymentStatus {
  if (options.explicitStatus === "cancelled") return "cancelled";
  const amount = Math.max(0, toNumber(options.amount));
  const received = Math.max(0, toNumber(options.receivedAmount));
  if (amount > 0 && received >= amount) return "received";
  const today = options.today || new Date().toISOString().slice(0, 10);
  const overdue = options.dueDate < today;
  if (received > 0 && received < amount) {
    return overdue ? "overdue" : "partially_received";
  }
  if (received <= 0 && overdue) return "overdue";
  return "pending";
}

export function paymentOutstandingBalance(payment: {
  amount: number;
  receivedAmount: number;
  status?: string | null;
}): number {
  if (payment.status === "cancelled") return 0;
  return Math.max(0, toNumber(payment.amount) - toNumber(payment.receivedAmount));
}

export function deriveProjectHealth(options: {
  executionStatus: WonExecutionStatus;
  milestones: Array<{ status: WonMilestoneStatus; dueDate: string }>;
  payments: Array<{
    amount: number;
    receivedAmount: number;
    dueDate: string;
    status?: string | null;
  }>;
  today?: string;
}): WonHealthStatus {
  if (options.executionStatus === "completed") return "completed";
  const today = options.today || new Date().toISOString().slice(0, 10);

  const hasPaymentOverdue = options.payments.some((payment) => {
    const derived = derivePaymentStatus({
      amount: payment.amount,
      receivedAmount: payment.receivedAmount,
      dueDate: payment.dueDate,
      explicitStatus: payment.status,
      today,
    });
    return (
      derived === "overdue" &&
      paymentOutstandingBalance(payment) > 0
    );
  });
  if (hasPaymentOverdue) return "payment_overdue";

  const hasDelayedMilestone = options.milestones.some((m) => {
    if (m.status === "completed") return false;
    return m.status === "delayed" || m.dueDate < today;
  });
  if (hasDelayedMilestone) return "delayed";

  return "on_track";
}

export type MarkTenderWonInput = {
  tenderId: string;
  awardDate: string;
  finalAwardValue: number;
  poNumber?: string | null;
  poDate?: string | null;
  contractNumber?: string | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  clientDepartment?: string | null;
  projectManagerId?: string | null;
  pbgApplicable?: boolean;
  pbgAmount?: number | null;
  pbgExpiryDate?: string | null;
  notes?: string | null;
};
