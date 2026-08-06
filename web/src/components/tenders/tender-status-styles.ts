import { STATUS_DISPLAY_LABELS, type TenderStatus } from "@/lib/tender-status";

export type QualificationStatus = TenderStatus;

export type QualificationStatusStyle = {
  label: string;
  shortLabel: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
};

export const qualificationStatusStyles: Record<
  QualificationStatus,
  QualificationStatusStyle
> = {
  GO: {
    label: STATUS_DISPLAY_LABELS.GO,
    shortLabel: "GO",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  CONDITIONAL_GO: {
    label: STATUS_DISPLAY_LABELS.CONDITIONAL_GO,
    shortLabel: "COND. GO",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  PARTNER_BID: {
    label: STATUS_DISPLAY_LABELS.PARTNER_BID,
    shortLabel: "PARTNER",
    bg: "bg-violet-50",
    text: "text-violet-800",
    border: "border-violet-200",
    dot: "bg-violet-600",
  },
  VERIFY: {
    label: STATUS_DISPLAY_LABELS.VERIFY,
    shortLabel: "VERIFY",
    bg: "bg-sky-50",
    text: "text-sky-800",
    border: "border-sky-200",
    dot: "bg-sky-600",
  },
  NO_GO: {
    label: STATUS_DISPLAY_LABELS.NO_GO,
    shortLabel: "NO-GO",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-500",
  },
};

export type TenderSource = "TENDER247" | "BIDASSIST";

export type SourceStyle = {
  label: string;
  bg: string;
  text: string;
  border: string;
};

export const sourceStyles: Record<TenderSource, SourceStyle> = {
  TENDER247: {
    label: "Tender247",
    bg: "bg-indigo-50",
    text: "text-indigo-800",
    border: "border-indigo-200",
  },
  BIDASSIST: {
    label: "BidAssist",
    bg: "bg-cyan-50",
    text: "text-cyan-800",
    border: "border-cyan-200",
  },
};
