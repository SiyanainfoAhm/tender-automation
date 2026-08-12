/**
 * Local audit outputs for Tender247 kept-pipeline integration test.
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import {
  ensureTender247DateScopedDir,
  getActiveTender247RunContext,
  requestedDateFromDateFolderSafe,
} from "../tender247Batch/tender247RunContext.js";
import type { KeptExcelCandidate } from "./parseKeptExcelRows.js";
import type { RelevanceScanRecord } from "./selectItRelevantCandidates.js";

export type KeptPipelinePathResult = {
  sourceTenderId: string;
  title: string;
  financialStatus: "KEEP";
  itRelevance: "IT_RELEVANT" | "NON_IT" | "AMBIGUOUS" | null;
  itRelevanceReasonCode: string | null;
  documentsDownloaded: boolean;
  supabaseStored: boolean;
  prescreenStatus: string | null;
  chatgptSubmitted: boolean;
  chatgptCompleted: boolean;
  chatgptResult: string | null;
  error: string | null;
};

export type FilteredPipelineSummaryInput = {
  excelRows: number;
  financialKeep: number;
  financialDrop: number;
  relevanceChecked: number;
  itRelevantFound: number;
  nonItDropped: number;
  ambiguous: number;
  itCandidatesSelected: number;
  documentsDownloaded: number;
  supabaseStored: number;
  prescreenPassed: number;
  chatgptSubmitted: number;
  chatgptCompleted: number;
};

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

  // OneDrive/Excel locks can cause EBUSY — retry then fall back to a sibling file.
  const attempts = [filePath];
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length || undefined);
  attempts.push(`${base}.${Date.now()}${ext || ".xlsx"}`);

  let lastError: unknown = null;
  for (const target of attempts) {
    for (let i = 0; i < 3; i += 1) {
      try {
        XLSX.writeFile(wb, target);
        return;
      } catch (error) {
        lastError = error;
        const code =
          typeof error === "object" && error && "code" in error
            ? String((error as { code: unknown }).code)
            : "";
        if (code !== "EBUSY" && code !== "EPERM") {
          throw error;
        }
        // brief backoff
        const start = Date.now();
        while (Date.now() - start < 150) {
          /* spin */
        }
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to write sheet ${filePath}`);
}

function scanToRow(r: RelevanceScanRecord): Record<string, unknown> {
  return {
    sourceTenderId: r.candidate.sourceTenderId,
    title: r.candidate.title,
    excelTenderValue: r.candidate.parsedTenderValueInr ?? "",
    excelEmd: r.candidate.parsedEmdInr ?? "",
    itRelevance: r.relevance,
    reasonCode: r.reasonCode,
    matchedTerms: r.matchedTerms.join("; "),
    negativeTerms: r.negativeTerms.join("; "),
    evidenceFields: r.evidenceFields.join("; "),
    candidateOrdinal: r.candidateOrdinal ?? "",
    detailOpened: r.detailOpened ? "true" : "false",
    detailResolved: r.detailResolved ? "true" : "false",
    explanation: r.explanation ?? "",
    error: r.error ?? "",
  };
}

function candidateToSelectedRow(
  c: KeptExcelCandidate,
  ordinal: number,
): Record<string, unknown> {
  return {
    "Candidate #": ordinal,
    "Tender247 ID": c.sourceTenderId,
    "Tender Name": c.title,
    "Estimated Cost": c.estimatedCostRaw ?? "",
    "Parsed Tender Value INR": c.parsedTenderValueInr ?? "",
    "EMD Raw": c.emdRaw ?? "",
    "Parsed EMD INR": c.parsedEmdInr ?? "",
    Deadline: c.deadline ?? "",
    "Excel Filter Status": c.excelFilterStatus,
    "Excel Filter Reason": c.excelFilterReason ?? "",
    "Financial Row Index": c.rowIndex,
  };
}

function pathToRow(r: KeptPipelinePathResult): Record<string, unknown> {
  return {
    "Tender247 ID": r.sourceTenderId,
    "Tender Name": r.title,
    "Financial Status": r.financialStatus,
    "IT Relevance": r.itRelevance ?? "",
    "IT Reason": r.itRelevanceReasonCode ?? "",
    "Documents Downloaded": r.documentsDownloaded ? "true" : "false",
    "Supabase Stored": r.supabaseStored ? "true" : "false",
    "Prescreen Status": r.prescreenStatus ?? "",
    "ChatGPT Submitted": r.chatgptSubmitted ? "true" : "false",
    "ChatGPT Completed": r.chatgptCompleted ? "true" : "false",
    "ChatGPT Result": r.chatgptResult ?? "",
    Error: r.error ?? "",
  };
}

/**
 * Write 04/05/06 into excel-filter-review (alongside 02-kept.xlsx).
 * 04-it-relevant = ALL IT_RELEVANT discovered during scan (not only selected).
 */
export function writeExcelFilterRelevanceReview(options: {
  reviewDir: string;
  scan: RelevanceScanRecord[];
  selectedItRelevant: RelevanceScanRecord[];
}): {
  itRelevantPath: string;
  nonItPath: string;
  ambiguousPath: string;
} {
  const requestedDate =
    getActiveTender247RunContext()?.requestedDate ??
    requestedDateFromDateFolderSafe(path.dirname(options.reviewDir)) ??
    undefined;
  ensureTender247DateScopedDir(options.reviewDir, requestedDate);

  const itRelevantPath = path.join(options.reviewDir, "04-it-relevant.xlsx");
  const nonItPath = path.join(options.reviewDir, "05-non-it-dropped.xlsx");
  const ambiguousPath = path.join(
    options.reviewDir,
    "06-ambiguous-manual-review.xlsx",
  );

  writeSheet(
    itRelevantPath,
    "IT_RELEVANT",
    options.scan.filter((r) => r.relevance === "IT_RELEVANT").map(scanToRow),
  );
  writeSheet(
    nonItPath,
    "NON_IT",
    options.scan.filter((r) => r.relevance === "NON_IT").map(scanToRow),
  );
  writeSheet(
    ambiguousPath,
    "AMBIGUOUS",
    options.scan.filter((r) => r.relevance === "AMBIGUOUS").map(scanToRow),
  );

  return { itRelevantPath, nonItPath, ambiguousPath };
}

export function writeKeptPipelineAudit(options: {
  dateFolder: string;
  selected: KeptExcelCandidate[];
  selectedOrdinals?: number[];
  scan: RelevanceScanRecord[];
  results: KeptPipelinePathResult[];
}): {
  auditDir: string;
  selectedPath: string;
  itRelevantPath: string;
  nonItPath: string;
  ambiguousPath: string;
  resultsJsonPath: string;
} {
  const auditDir = path.join(options.dateFolder, "kept-pipeline-test");
  const requestedDate =
    getActiveTender247RunContext()?.requestedDate ??
    requestedDateFromDateFolderSafe(options.dateFolder) ??
    undefined;
  ensureTender247DateScopedDir(auditDir, requestedDate);

  const selectedPath = path.join(auditDir, "selected-candidates.xlsx");
  const itRelevantPath = path.join(auditDir, "it-relevant.xlsx");
  const nonItPath = path.join(auditDir, "non-it-dropped.xlsx");
  const ambiguousPath = path.join(auditDir, "ambiguous-review.xlsx");
  const resultsJsonPath = path.join(auditDir, "pipeline-results.json");

  writeSheet(
    selectedPath,
    "Selected",
    options.selected.map((c, i) =>
      candidateToSelectedRow(c, options.selectedOrdinals?.[i] ?? i + 1),
    ),
  );

  writeSheet(
    itRelevantPath,
    "IT_RELEVANT",
    options.scan.filter((r) => r.relevance === "IT_RELEVANT").map(scanToRow),
  );
  writeSheet(
    nonItPath,
    "NON_IT",
    options.scan.filter((r) => r.relevance === "NON_IT").map(scanToRow),
  );
  writeSheet(
    ambiguousPath,
    "AMBIGUOUS",
    options.scan.filter((r) => r.relevance === "AMBIGUOUS").map(scanToRow),
  );

  const resultsXlsxPath = path.join(auditDir, "pipeline-results.xlsx");
  writeSheet(resultsXlsxPath, "Results", options.results.map(pathToRow));

  fs.writeFileSync(
    resultsJsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        selectedCount: options.selected.length,
        relevanceScanCount: options.scan.length,
        results: options.results,
        scan: options.scan.map((r) => ({
          sourceTenderId: r.candidate.sourceTenderId,
          relevance: r.relevance,
          reasonCode: r.reasonCode,
          candidateOrdinal: r.candidateOrdinal,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    auditDir,
    selectedPath,
    itRelevantPath,
    nonItPath,
    ambiguousPath,
    resultsJsonPath,
  };
}

export function printFilteredPipelineSummary(
  input: FilteredPipelineSummaryInput,
): void {
  console.log("");
  console.log("=============================================");
  console.log("Tender247 Filtered Pipeline Test");
  console.log("=============================================");
  console.log(`Excel rows: ${input.excelRows}`);
  console.log(`Financial KEEP: ${input.financialKeep}`);
  console.log(`Financial DROP: ${input.financialDrop}`);
  console.log("");
  console.log(`Relevance checked: ${input.relevanceChecked}`);
  console.log(`IT_RELEVANT found: ${input.itRelevantFound}`);
  console.log(`NON_IT dropped: ${input.nonItDropped}`);
  console.log(`AMBIGUOUS: ${input.ambiguous}`);
  console.log("");
  console.log(
    `IT candidates selected for this test: ${input.itCandidatesSelected}`,
  );
  console.log("");
  console.log(`Documents downloaded: ${input.documentsDownloaded}`);
  console.log(`Supabase stored: ${input.supabaseStored}`);
  console.log(`Prescreen passed: ${input.prescreenPassed}`);
  console.log(`ChatGPT submitted: ${input.chatgptSubmitted}`);
  console.log(`ChatGPT completed: ${input.chatgptCompleted}`);
  console.log("=============================================");
  console.log("");
}

export function printKeptPipelineCandidatePaths(
  results: KeptPipelinePathResult[],
): void {
  for (const r of results) {
    console.log(`T247-${r.sourceTenderId}`);
    console.log(`FINANCIAL=${r.financialStatus}`);
    console.log(`IT_RELEVANCE=${r.itRelevance ?? "UNKNOWN"}`);
    console.log(
      `DOCUMENTS=${r.documentsDownloaded ? "DOWNLOADED" : "SKIPPED"}`,
    );
    console.log(`SUPABASE=${r.supabaseStored ? "STORED" : "SKIPPED"}`);
    console.log(`PRESCREEN=${r.prescreenStatus ?? "N/A"}`);
    console.log(
      `CHATGPT=${r.chatgptSubmitted ? "SUBMITTED" : "SKIPPED"}`,
    );
    console.log(`RESULT=${r.chatgptResult ?? "N/A"}`);
    if (r.error) {
      console.log(`ERROR=${r.error}`);
    }
    console.log("");
  }
}
