/**
 * Local audit outputs for Tender247 IT relevance gate (pre-Supabase).
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { ensureDir } from "../fileUtils.js";
import type {
  Tender247ItRelevance,
  Tender247ItRelevanceReasonCode,
} from "../prescreen/tender247ItRelevanceClassifier.js";

export type ItRelevanceAuditRecord = {
  sourceTenderId: string;
  title: string;
  excelTenderValue: number | null;
  excelEmd: number | null;
  relevance: Tender247ItRelevance;
  reasonCode: Tender247ItRelevanceReasonCode | string;
  matchedTerms: string[];
  negativeTerms: string[];
  evidenceFields: string[];
  explanation?: string;
};

export type ItRelevanceAuditSummary = {
  itRelevant: number;
  nonItDropped: number;
  ambiguousManualReview: number;
  records: ItRelevanceAuditRecord[];
};

function auditRow(r: ItRelevanceAuditRecord): Record<string, unknown> {
  return {
    sourceTenderId: r.sourceTenderId,
    title: r.title,
    excelTenderValue: r.excelTenderValue ?? "",
    excelEmd: r.excelEmd ?? "",
    itRelevance: r.relevance,
    reasonCode: r.reasonCode,
    matchedTerms: r.matchedTerms.join("; "),
    negativeTerms: r.negativeTerms.join("; "),
    evidenceFields: r.evidenceFields.join("; "),
    explanation: r.explanation ?? "",
  };
}

function writeSheet(
  filePath: string,
  sheetName: string,
  rows: Record<string, unknown>[],
): void {
  const wb = XLSX.utils.book_new();
  const ws =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([["(no rows)"]]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filePath);
}

export function writeItRelevanceAuditOutputs(options: {
  dateFolder: string;
  records: ItRelevanceAuditRecord[];
}): {
  reviewDir: string;
  itRelevantPath: string;
  nonItPath: string;
  ambiguousPath: string;
  jsonPath: string;
  summary: ItRelevanceAuditSummary;
} {
  const reviewDir = path.join(options.dateFolder, "tender247-filter-review");
  ensureDir(reviewDir);

  const itRelevant = options.records.filter((r) => r.relevance === "IT_RELEVANT");
  const nonIt = options.records.filter((r) => r.relevance === "NON_IT");
  const ambiguous = options.records.filter((r) => r.relevance === "AMBIGUOUS");

  const itRelevantPath = path.join(reviewDir, "04-it-relevant.xlsx");
  const nonItPath = path.join(reviewDir, "05-non-it-dropped.xlsx");
  const ambiguousPath = path.join(reviewDir, "06-ambiguous-manual-review.xlsx");
  const jsonPath = path.join(reviewDir, "it-relevance-audit.json");

  writeSheet(itRelevantPath, "IT_RELEVANT", itRelevant.map(auditRow));
  writeSheet(nonItPath, "NON_IT", nonIt.map(auditRow));
  writeSheet(ambiguousPath, "AMBIGUOUS", ambiguous.map(auditRow));

  const summary: ItRelevanceAuditSummary = {
    itRelevant: itRelevant.length,
    nonItDropped: nonIt.length,
    ambiguousManualReview: ambiguous.length,
    records: options.records,
  };

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary: {
          itRelevant: summary.itRelevant,
          nonItDropped: summary.nonItDropped,
          ambiguousManualReview: summary.ambiguousManualReview,
        },
        records: options.records,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    reviewDir,
    itRelevantPath,
    nonItPath,
    ambiguousPath,
    jsonPath,
    summary,
  };
}

export function printTender247ScreeningSummary(input: {
  excelRows: number;
  droppedFinancialGate: number;
  financialSurvivors: number;
  itRelevant: number;
  nonItDropped: number;
  ambiguousManualReview: number;
  documentDownloads: number;
  supabaseStored: number;
  detailedPrescreenPassed: number;
  detailedPrescreenRejected: number;
  chatgptSubmitted: number;
}): void {
  console.log("");
  console.log("========================================");
  console.log("Tender247 Screening Summary");
  console.log("========================================");
  console.log(`Excel rows: ${input.excelRows}`);
  console.log(`Dropped financial gate: ${input.droppedFinancialGate}`);
  console.log("");
  console.log(`Financial survivors: ${input.financialSurvivors}`);
  console.log("");
  console.log(`IT relevant: ${input.itRelevant}`);
  console.log(`Non-IT dropped: ${input.nonItDropped}`);
  console.log(`Ambiguous/manual review: ${input.ambiguousManualReview}`);
  console.log("");
  console.log(`Document downloads: ${input.documentDownloads}`);
  console.log(`Supabase stored: ${input.supabaseStored}`);
  console.log(`Detailed prescreen passed: ${input.detailedPrescreenPassed}`);
  console.log(`Detailed prescreen rejected: ${input.detailedPrescreenRejected}`);
  console.log(`ChatGPT submitted: ${input.chatgptSubmitted}`);
  console.log("========================================");
  console.log("");
}
