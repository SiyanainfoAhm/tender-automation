import fs from "node:fs";
import path from "node:path";
import type { TenderArtifactState } from "./tenderArtifactState.js";

export type RecoveryReportStatus =
  | "complete"
  | "recovered"
  | "pending_timeout";

export type Tender247RecoveryReportItem = {
  metadata: boolean;
  aiSummary: boolean;
  documents: boolean;
  status: RecoveryReportStatus;
  reason?: string;
};

export type Tender247RecoveryReport = {
  complete: number;
  pendingTimeout: number;
  recovered: number;
  items: Record<string, Tender247RecoveryReportItem>;
};

export function emptyRecoveryReport(): Tender247RecoveryReport {
  return { complete: 0, pendingTimeout: 0, recovered: 0, items: {} };
}

export function recordRecoveryItem(
  report: Tender247RecoveryReport,
  t247Id: string,
  state: TenderArtifactState,
  status: RecoveryReportStatus,
  reason?: string,
): void {
  report.items[t247Id] = {
    metadata: state.metadataValid,
    aiSummary: state.aiSummaryValid,
    documents: state.documentsZipValid,
    status,
    ...(reason ? { reason } : {}),
  };
  report.complete = Object.values(report.items).filter(
    (item) => item.status === "complete",
  ).length;
  report.pendingTimeout = Object.values(report.items).filter(
    (item) => item.status === "pending_timeout",
  ).length;
  report.recovered = Object.values(report.items).filter(
    (item) => item.status === "recovered",
  ).length;
}

export function writeTender247RecoveryReport(
  dateFolder: string,
  report: Tender247RecoveryReport,
): string {
  const outPath = path.join(dateFolder, "tender247-recovery-report.json");
  fs.mkdirSync(dateFolder, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  return outPath;
}
