/**
 * Per-candidate audit bundle for Tender247 until-GO validation runs.
 */
import fs from "node:fs";
import path from "node:path";
import type { AttachmentManifestAudit } from "../chatgptQualification/tender247AttachmentManifest.js";
import { getTenderPrescreenGate } from "../prescreen/prescreenRepository.js";
import { getTenderMetadata } from "../supabase/tenderMetadataStore.js";
import {
  ensureTender247DateScopedDir,
  getActiveTender247RunContext,
  requestedDateFromDateFolderSafe,
} from "../tender247Batch/tender247RunContext.js";
import type { KeptExcelCandidate } from "./parseKeptExcelRows.js";

export function resolveUntilGoAuditDir(
  dateFolder: string,
  sourceTenderId: string,
): string {
  return path.join(dateFolder, "until-go-audit", `T247-${sourceTenderId}`);
}

export async function buildSourceFacts(options: {
  candidate: KeptExcelCandidate;
  sourceTenderId: string;
  supabaseExisting: boolean;
  documentsDownloaded: boolean;
  prescreenStatus: string | null;
}): Promise<Record<string, unknown>> {
  const meta = await getTenderMetadata("TENDER247", options.sourceTenderId);
  const gate = await getTenderPrescreenGate({
    sourcePortal: "TENDER247",
    sourceTenderId: options.sourceTenderId,
  });

  const tenderFolder = meta?.local_folder_path || null;
  const aiSummaryPath = tenderFolder
    ? path.join(tenderFolder, "AI_Summary.pdf")
    : null;
  const archivePath = tenderFolder
    ? path.join(tenderFolder, "documents", "Tender_All_Documents.zip")
    : null;

  return {
    sourcePortal: "TENDER247",
    sourceTenderId: options.sourceTenderId,
    title: options.candidate.title,
    excel: {
      tenderValueInr: options.candidate.parsedTenderValueInr,
      emdInr: options.candidate.parsedEmdInr,
      estimatedCostRaw: options.candidate.estimatedCostRaw,
      emdRaw: options.candidate.emdRaw,
      deadline: options.candidate.deadline,
      filterStatus: options.candidate.excelFilterStatus,
      filterReason: options.candidate.excelFilterReason,
    },
    supabaseExisting: options.supabaseExisting,
    documentsDownloaded: options.documentsDownloaded,
    aiSummaryAvailable: Boolean(
      aiSummaryPath && fs.existsSync(aiSummaryPath) && fs.statSync(aiSummaryPath).size > 0,
    ),
    documentArchivePath: archivePath,
    prescreen: {
      status: options.prescreenStatus,
      chatgptEligible: gate.row?.chatgpt_eligible ?? null,
      reasonCode: gate.row?.prescreen_reason_code ?? null,
      qualificationStatus: gate.row?.qualification_status ?? null,
    },
    metadataKeys:
      meta?.raw_metadata && typeof meta.raw_metadata === "object"
        ? Object.keys(meta.raw_metadata).sort()
        : [],
    capturedAt: new Date().toISOString(),
  };
}

export async function writeUntilGoCandidateAudit(options: {
  dateFolder: string;
  sourceTenderId: string;
  candidate: KeptExcelCandidate;
  tenderFolder: string;
  supabaseExisting: boolean;
  documentsDownloaded: boolean;
  prescreenStatus: string | null;
  attachmentManifest?: AttachmentManifestAudit | null;
  chatUrl?: string | null;
}): Promise<string> {
  const auditDir = resolveUntilGoAuditDir(
    options.dateFolder,
    options.sourceTenderId,
  );
  const requestedDate =
    getActiveTender247RunContext()?.requestedDate ??
    requestedDateFromDateFolderSafe(options.dateFolder) ??
    undefined;
  ensureTender247DateScopedDir(auditDir, requestedDate);

  const promptSrc = path.join(options.tenderFolder, "qualification-prompt.txt");
  const responseSrc = path.join(
    options.tenderFolder,
    "qualification-response.txt",
  );
  const resultSrc = path.join(
    options.tenderFolder,
    "qualification-result.json",
  );
  const manifestSrc = path.join(options.tenderFolder, "03-attachment-manifest.json");

  if (fs.existsSync(promptSrc)) {
    fs.copyFileSync(promptSrc, path.join(auditDir, "01-prompt.txt"));
  } else {
    fs.writeFileSync(
      path.join(auditDir, "01-prompt.txt"),
      "",
      "utf8",
    );
  }

  const meta = await getTenderMetadata("TENDER247", options.sourceTenderId);
  fs.writeFileSync(
    path.join(auditDir, "02-metadata-sent-to-chatgpt.json"),
    JSON.stringify(meta?.raw_metadata ?? {}, null, 2),
    "utf8",
  );

  if (options.attachmentManifest) {
    fs.writeFileSync(
      path.join(auditDir, "03-attachment-manifest.json"),
      JSON.stringify(options.attachmentManifest, null, 2),
      "utf8",
    );
  } else if (fs.existsSync(manifestSrc)) {
    fs.copyFileSync(
      manifestSrc,
      path.join(auditDir, "03-attachment-manifest.json"),
    );
  } else {
    fs.writeFileSync(
      path.join(auditDir, "03-attachment-manifest.json"),
      JSON.stringify(
        {
          expectedCount: null,
          visibleCount: null,
          filesAssignedCount: null,
          uploadLimitWarningSeen: false,
          files: [],
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  if (fs.existsSync(responseSrc)) {
    fs.copyFileSync(responseSrc, path.join(auditDir, "04-raw-chatgpt-response.txt"));
  } else {
    fs.writeFileSync(path.join(auditDir, "04-raw-chatgpt-response.txt"), "", "utf8");
  }

  if (fs.existsSync(resultSrc)) {
    fs.copyFileSync(resultSrc, path.join(auditDir, "05-parsed-qualification.json"));
  } else {
    fs.writeFileSync(
      path.join(auditDir, "05-parsed-qualification.json"),
      "{}",
      "utf8",
    );
  }

  const sourceFacts = await buildSourceFacts({
    candidate: options.candidate,
    sourceTenderId: options.sourceTenderId,
    supabaseExisting: options.supabaseExisting,
    documentsDownloaded: options.documentsDownloaded,
    prescreenStatus: options.prescreenStatus,
  });
  if (options.chatUrl) {
    sourceFacts.chatUrl = options.chatUrl;
  }
  fs.writeFileSync(
    path.join(auditDir, "06-source-facts.json"),
    JSON.stringify(sourceFacts, null, 2),
    "utf8",
  );

  return auditDir;
}

export type UntilGoSummaryStats = {
  excelRows: number;
  financialDropped: number;
  financialSurvivors: number;
  relevanceChecked: number;
  itRelevant: number;
  nonIt: number;
  ambiguous: number;
  prescreenPassed: number;
  prescreenRejected: number;
  manualReview: number;
  chatgptSubmitted: number;
  noGo: number;
  verify: number;
  conditionalGo: number;
  partnerBid: number;
  go: number;
  goFound: boolean;
  goTenderId: string | null;
  goChatUrl: string | null;
  goAuditFolder: string | null;
};

export function printUntilGoSummary(stats: UntilGoSummaryStats): void {
  console.log("");
  console.log("========================================");
  console.log("Tender247 UNTIL GO Validation");
  console.log("========================================");
  console.log(`Excel rows: ${stats.excelRows}`);
  console.log(`Financial dropped: ${stats.financialDropped}`);
  console.log(`Financial survivors: ${stats.financialSurvivors}`);
  console.log("");
  console.log(`IT relevance checked: ${stats.relevanceChecked}`);
  console.log(`IT_RELEVANT: ${stats.itRelevant}`);
  console.log(`NON_IT: ${stats.nonIt}`);
  console.log(`AMBIGUOUS: ${stats.ambiguous}`);
  console.log("");
  console.log(`Prescreen passed: ${stats.prescreenPassed}`);
  console.log(`Prescreen rejected: ${stats.prescreenRejected}`);
  console.log(`Manual review: ${stats.manualReview}`);
  console.log("");
  console.log(`ChatGPT submitted: ${stats.chatgptSubmitted}`);
  console.log("");
  console.log(`NO_GO: ${stats.noGo}`);
  console.log(`VERIFY: ${stats.verify}`);
  console.log(`CONDITIONAL_GO: ${stats.conditionalGo}`);
  console.log(`PARTNER_BID: ${stats.partnerBid}`);
  console.log(`GO: ${stats.go}`);
  console.log("");
  console.log(`GO FOUND: ${stats.goFound ? "YES" : "NO"}`);
  console.log("========================================");
  console.log("");
}
