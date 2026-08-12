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
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-500/30",
    dot: "bg-emerald-500",
  },
  CONDITIONAL_GO: {
    label: STATUS_DISPLAY_LABELS.CONDITIONAL_GO,
    shortLabel: "COND. GO",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-500/30",
    dot: "bg-amber-500",
  },
  PARTNER_BID: {
    label: STATUS_DISPLAY_LABELS.PARTNER_BID,
    shortLabel: "PARTNER",
    bg: "bg-violet-50 dark:bg-violet-500/10",
    text: "text-violet-800 dark:text-violet-300",
    border: "border-violet-200 dark:border-violet-500/30",
    dot: "bg-violet-600 dark:bg-violet-400",
  },
  VERIFY: {
    label: STATUS_DISPLAY_LABELS.VERIFY,
    shortLabel: "VERIFY",
    bg: "bg-sky-50 dark:bg-sky-500/10",
    text: "text-sky-800 dark:text-sky-300",
    border: "border-sky-200 dark:border-sky-500/30",
    dot: "bg-sky-600 dark:bg-sky-400",
  },
  NO_GO: {
    label: STATUS_DISPLAY_LABELS.NO_GO,
    shortLabel: "NO-GO",
    bg: "bg-red-50 dark:bg-red-500/10",
    text: "text-red-700 dark:text-red-300",
    border: "border-red-200 dark:border-red-500/30",
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
    bg: "bg-indigo-50 dark:bg-indigo-500/10",
    text: "text-indigo-800 dark:text-indigo-300",
    border: "border-indigo-200 dark:border-indigo-500/30",
  },
  BIDASSIST: {
    label: "BidAssist",
    bg: "bg-cyan-50 dark:bg-cyan-500/10",
    text: "text-cyan-800 dark:text-cyan-300",
    border: "border-cyan-200 dark:border-cyan-500/30",
  },
};
