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
    shortLabel: "Will Bid",
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  CONDITIONAL_GO: {
    label: STATUS_DISPLAY_LABELS.CONDITIONAL_GO,
    shortLabel: "May Bid",
    bg: "bg-violet-100",
    text: "text-violet-700",
    border: "border-violet-200",
    dot: "bg-violet-500",
  },
  PARTNER_BID: {
    label: STATUS_DISPLAY_LABELS.PARTNER_BID,
    shortLabel: "Partnership",
    bg: "bg-indigo-100",
    text: "text-indigo-700",
    border: "border-indigo-200",
    dot: "bg-indigo-600",
  },
  VERIFY: {
    label: STATUS_DISPLAY_LABELS.VERIFY,
    shortLabel: "Screening",
    bg: "bg-sky-100",
    text: "text-sky-700",
    border: "border-sky-200",
    dot: "bg-sky-600",
  },
  NO_GO: {
    label: STATUS_DISPLAY_LABELS.NO_GO,
    shortLabel: "No Bid",
    bg: "bg-rose-100",
    text: "text-rose-700",
    border: "border-rose-200",
    dot: "bg-rose-500",
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
    bg: "bg-violet-100",
    text: "text-violet-800",
    border: "border-violet-200",
  },
  BIDASSIST: {
    label: "BidAssist",
    bg: "bg-purple-100",
    text: "text-purple-800",
    border: "border-purple-200",
  },
};
