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
    bg: "bg-amber-100",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-500",
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
    shortLabel: "Verify",
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
  DUPLICATE: {
    label: STATUS_DISPLAY_LABELS.DUPLICATE,
    shortLabel: "Duplicate",
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-200",
    dot: "bg-slate-500",
  },
  WON: {
    label: STATUS_DISPLAY_LABELS.WON,
    shortLabel: "Won",
    bg: "bg-emerald-100",
    text: "text-emerald-800",
    border: "border-emerald-300",
    dot: "bg-emerald-600",
  },
  LOST: {
    label: STATUS_DISPLAY_LABELS.LOST,
    shortLabel: "Lost",
    bg: "bg-rose-100",
    text: "text-rose-800",
    border: "border-rose-300",
    dot: "bg-rose-600",
  },
  DISQUALIFIED: {
    label: STATUS_DISPLAY_LABELS.DISQUALIFIED,
    shortLabel: "Disqualified",
    bg: "bg-red-100",
    text: "text-red-800",
    border: "border-red-300",
    dot: "bg-red-600",
  },
  SUBMITTED: {
    label: STATUS_DISPLAY_LABELS.SUBMITTED,
    shortLabel: "Submitted",
    bg: "bg-blue-100",
    text: "text-blue-800",
    border: "border-blue-300",
    dot: "bg-blue-600",
  },
  CANCELLED: {
    label: STATUS_DISPLAY_LABELS.CANCELLED,
    shortLabel: "Cancelled",
    bg: "bg-stone-100",
    text: "text-stone-800",
    border: "border-stone-300",
    dot: "bg-stone-500",
  },
};

export type TenderSource = "TENDER247" | "BIDASSIST" | "MANUAL";

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
  MANUAL: {
    label: "Manual",
    bg: "bg-slate-100",
    text: "text-slate-800",
    border: "border-slate-200",
  },
};
