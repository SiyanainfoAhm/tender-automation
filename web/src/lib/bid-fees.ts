export const BID_FEE_TYPES = [
  "tender_fee",
  "emd",
  "processing",
  "pbg",
  "other",
] as const;

export type BidFeeType = (typeof BID_FEE_TYPES)[number];

export const BID_FEE_TYPE_LABELS: Record<BidFeeType, string> = {
  tender_fee: "Tender Fees",
  emd: "EMD / Bid Security",
  processing: "Processing Fees",
  pbg: "Performance Guarantee",
  other: "Other",
};

export const BID_FEE_STATUSES = [
  "pending",
  "submitted",
  "paid",
  "refunded",
  "released",
  "expired",
] as const;

export type BidFeeStatus = (typeof BID_FEE_STATUSES)[number];

export const BID_FEE_STATUS_LABELS: Record<BidFeeStatus, string> = {
  pending: "Pending",
  submitted: "Submitted",
  paid: "Paid",
  refunded: "Refunded",
  released: "Released",
  expired: "Expired",
};

export const PAYMENT_MODES = [
  "neft_rtgs",
  "netbanking_upi",
  "dd",
  "fdr",
  "bank_guarantee",
  "cash_other",
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  neft_rtgs: "NEFT/RTGS",
  netbanking_upi: "Net-Banking/UPI",
  dd: "DD/Banker's Cheque",
  fdr: "FDR",
  bank_guarantee: "Bank Guarantee/e-BG",
  cash_other: "Cash / Other",
};

export const PBG_STATUSES = ["active", "released", "expired"] as const;
export type PbgStatus = (typeof PBG_STATUSES)[number];

export const TENDER_DOCUMENT_SECTIONS = [
  "tender",
  "bidding",
  "financial",
  "deliverable",
] as const;

export type TenderDocumentSection = (typeof TENDER_DOCUMENT_SECTIONS)[number];

export type PaymentReference = Record<string, string | number | boolean | null>;

export type BidFeeRecord = {
  id: string;
  companyId: string;
  tenderId: string;
  feeType: BidFeeType;
  amount: number;
  currency: string;
  status: BidFeeStatus;
  paymentMode: PaymentMode | null;
  paymentDate: string | null;
  dueDate: string | null;
  refundable: boolean;
  notes: string | null;
  paymentReference: PaymentReference;
  bgNumber: string | null;
  bankName: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  claimPeriodDays: number | null;
  urn: string | null;
  pbgStatus: PbgStatus | null;
  createdAt: string;
  updatedAt: string;
  /** Joined tender fields for list UI */
  tenderTitle?: string | null;
  tenderSourceId?: string | null;
  tenderReference?: string | null;
  tenderOrganization?: string | null;
  tenderStatus?: string | null;
};

export type TenderDocumentRecord = {
  id: string;
  companyId: string;
  tenderId: string;
  section: TenderDocumentSection;
  entityType: string | null;
  entityId: string | null;
  feeId: string | null;
  companyDocumentId: string | null;
  fileName: string;
  originalName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  storageProvider: string;
  storageUrl: string | null;
  createdAt: string;
  downloadUrl: string | null;
};

export function isBidFeeType(value: string): value is BidFeeType {
  return (BID_FEE_TYPES as readonly string[]).includes(value);
}

export function isBidFeeStatus(value: string): value is BidFeeStatus {
  return (BID_FEE_STATUSES as readonly string[]).includes(value);
}

export function isPaymentMode(value: string): value is PaymentMode {
  return (PAYMENT_MODES as readonly string[]).includes(value);
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pbgExpiryTone(
  expiryDate: string | null | undefined,
  now = new Date(),
): "green" | "orange" | "red" | "neutral" {
  if (!expiryDate) return "neutral";
  const end = new Date(`${expiryDate}T12:00:00`);
  if (Number.isNaN(end.getTime())) return "neutral";
  const ms = end.getTime() - now.getTime();
  const days = Math.ceil(ms / 86_400_000);
  if (days < 0) return "red";
  if (days <= 90) return "orange";
  return "green";
}
