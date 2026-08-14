export type ImportPortal = "TENDER247" | "BIDASSIST";

export type ImportSourceSummary = {
  source: ImportPortal;
  name: string;
  description: string;
  connected: boolean;
  tenderCount: number;
  lastSyncAt: string | null;
  lastSyncLabel: string;
};

export type ImportHistoryRow = {
  id: string;
  source: ImportPortal;
  sourceLabel: string;
  date: string;
  total: number;
  added: number;
  duplicates: number;
  status: "Completed";
};

export type ImportPreviewRow = {
  id: string;
  title: string;
  sourceTenderId: string;
  folderId: string | null;
  organization: string | null;
  category: string | null;
  tenderValue: number | null;
  tenderValueText: string | null;
  closingDate: string | null;
  sourcePortal: ImportPortal;
  isDuplicate: boolean;
};

export type ImportPreviewFilters = {
  source: ImportPortal;
  keywords?: string;
  location?: string;
  minValue?: number;
  maxValue?: number;
  minDaysToDeadline?: number;
};
