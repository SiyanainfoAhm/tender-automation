/**
 * Canonical Tender247 qualification-evidence-state.json writer.
 * One schema, invariant checks, written only after disk verification.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../fileUtils.js";

export const EVIDENCE_STATE_FILE = "qualification-evidence-state.json";
export const EVIDENCE_STATE_TMP_FILE = "qualification-evidence-state.tmp.json";

export type EvidenceStageStatus =
  | "not_attempted"
  | "processing"
  | "complete"
  | "partial"
  | "unavailable"
  | "failed";

export type EvidenceStage = {
  attempted: boolean;
  available: boolean;
  status: EvidenceStageStatus;
  path?: string;
};

export type Tender247EvidenceState = {
  t247Id: string;
  metadata: EvidenceStage;
  aiSummary: EvidenceStage;
  documents: EvidenceStage & {
    downloadAllAttempted: boolean;
    downloadAllSuccess?: boolean;
    individualFallbackUsed: boolean;
  };
  evidenceMode: "FULL" | "PARTIAL" | "NONE" | "STRONG_PARTIAL";
  artifactTransactionComplete: boolean;
  individualDocsFound?: number;
  individualDocsSuccess?: number;
  individualDocsFailed?: string[];
  canonicalZipReady?: boolean;
  availableFiles?: string[];
  missingFiles?: string[];
  downloadAttempted?: boolean;
  downloadSuccess?: boolean;
  metadataRepairAttempted?: boolean;
  documentsCreatedLocally?: boolean;
  localDocumentCount?: number;
  evidenceCount?: number;
  updatedAt: string;
};

export class Tender247EvidenceStateInvariantError extends Error {
  readonly code = "T247_EVIDENCE_STATE_INVARIANT_VIOLATION";
  constructor(message: string) {
    super(`T247_EVIDENCE_STATE_INVARIANT_VIOLATION ${message}`);
    this.name = "Tender247EvidenceStateInvariantError";
  }
}

function stage(
  attempted: boolean,
  available: boolean,
  status: EvidenceStageStatus,
  filePath?: string | null,
): EvidenceStage {
  return {
    attempted,
    available,
    status: attempted ? status : "not_attempted",
    ...(filePath ? { path: filePath } : {}),
  };
}

export function assertEvidenceStateInvariants(
  state: Tender247EvidenceState,
): void {
  if (state.documents.downloadAllAttempted && !state.documents.attempted) {
    throw new Tender247EvidenceStateInvariantError(
      "downloadAllAttempted=true requires documents.attempted=true",
    );
  }
  if (state.documents.individualFallbackUsed && !state.documents.attempted) {
    throw new Tender247EvidenceStateInvariantError(
      "individualFallbackUsed=true requires documents.attempted=true",
    );
  }
  if (
    state.documents.individualFallbackUsed &&
    !state.documents.downloadAllAttempted
  ) {
    throw new Tender247EvidenceStateInvariantError(
      "individualFallbackUsed=true requires downloadAllAttempted=true",
    );
  }
  if (!state.documents.attempted && state.documents.status !== "not_attempted") {
    throw new Tender247EvidenceStateInvariantError(
      "documents.attempted=false requires status=not_attempted",
    );
  }
  if (!state.aiSummary.attempted && state.aiSummary.status !== "not_attempted") {
    throw new Tender247EvidenceStateInvariantError(
      "aiSummary.attempted=false requires status=not_attempted",
    );
  }
  if (state.aiSummary.attempted && state.aiSummary.status === "not_attempted") {
    throw new Tender247EvidenceStateInvariantError(
      "aiSummary.attempted=true cannot use status=not_attempted",
    );
  }
  if (state.metadata.attempted && state.metadata.status === "not_attempted") {
    throw new Tender247EvidenceStateInvariantError(
      "metadata.attempted=true cannot use status=not_attempted",
    );
  }
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf8");
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  fs.renameSync(tmpPath, filePath);
}

export function loadEvidenceState(
  tenderDir: string,
): Tender247EvidenceState | null {
  const filePath = path.join(tenderDir, EVIDENCE_STATE_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Tender247EvidenceState;
  } catch {
    return null;
  }
}

export function writeInterimEvidenceState(
  tenderDir: string,
  state: Tender247EvidenceState,
): void {
  assertEvidenceStateInvariants(state);
  if (!fs.existsSync(tenderDir)) return;
  writeJsonAtomic(path.join(tenderDir, EVIDENCE_STATE_TMP_FILE), state);
}

export function writeFinalEvidenceState(
  tenderDir: string,
  state: Tender247EvidenceState,
): void {
  const complete: Tender247EvidenceState = {
    ...state,
    artifactTransactionComplete: true,
    updatedAt: new Date().toISOString(),
  };
  assertEvidenceStateInvariants(complete);
  if (!fs.existsSync(tenderDir)) return;
  writeJsonAtomic(path.join(tenderDir, EVIDENCE_STATE_FILE), complete);
  const tmp = path.join(tenderDir, EVIDENCE_STATE_TMP_FILE);
  if (fs.existsSync(tmp)) {
    fs.unlinkSync(tmp);
  }
}

export function buildFinalEvidenceState(input: {
  t247Id: string;
  metadataAttempted: boolean;
  metadataAvailable: boolean;
  metadataStatus: EvidenceStageStatus;
  aiAttempted: boolean;
  aiAvailable: boolean;
  aiStatus: EvidenceStageStatus;
  aiPath?: string | null;
  documentsAttempted: boolean;
  documentsAvailable: boolean;
  documentsStatus: EvidenceStageStatus;
  documentsPath?: string | null;
  downloadAllAttempted: boolean;
  downloadAllSuccess: boolean;
  individualFallbackUsed: boolean;
  individualDocsFound?: number;
  individualDocsSuccess?: number;
  individualDocsFailed?: string[];
  canonicalZipReady?: boolean;
}): Tender247EvidenceState {
  const documentsAttempted =
    input.documentsAttempted ||
    input.downloadAllAttempted ||
    input.individualFallbackUsed;
  const metadata = stage(
    input.metadataAttempted,
    input.metadataAvailable,
    input.metadataStatus,
  );
  const aiSummary = stage(
    input.aiAttempted,
    input.aiAvailable,
    input.aiStatus,
    input.aiPath,
  );
  const documents: Tender247EvidenceState["documents"] = {
    ...stage(
      documentsAttempted,
      input.documentsAvailable,
      input.documentsStatus,
      input.documentsPath,
    ),
    downloadAllAttempted:
      input.downloadAllAttempted || input.individualFallbackUsed,
    downloadAllSuccess: input.downloadAllSuccess,
    individualFallbackUsed: input.individualFallbackUsed,
  };

  const evidenceCount =
    (metadata.available ? 1 : 0) +
    (aiSummary.available ? 1 : 0) +
    (documents.available ? 1 : 0);
  const evidenceMode: Tender247EvidenceState["evidenceMode"] =
    evidenceCount === 3 ? "FULL" : evidenceCount >= 1 ? "PARTIAL" : "NONE";

  const availableFiles: string[] = [];
  const missingFiles: string[] = [];
  if (metadata.available) availableFiles.push("metadata");
  else if (metadata.attempted) missingFiles.push("metadata.json");
  if (aiSummary.available) availableFiles.push("AI_Summary.pdf");
  else if (aiSummary.attempted) missingFiles.push("AI_Summary.pdf");
  if (documents.available) availableFiles.push("Tender_All_Documents.zip");
  else if (documents.attempted) missingFiles.push("Tender_All_Documents.zip");

  return {
    t247Id: input.t247Id,
    metadata,
    aiSummary,
    documents,
    evidenceMode,
    artifactTransactionComplete: true,
    individualDocsFound: input.individualDocsFound,
    individualDocsSuccess: input.individualDocsSuccess,
    individualDocsFailed: input.individualDocsFailed,
    canonicalZipReady: input.canonicalZipReady,
    availableFiles,
    missingFiles,
    downloadAttempted: documentsAttempted,
    downloadSuccess: input.documentsAvailable,
    evidenceCount,
    updatedAt: new Date().toISOString(),
  };
}

/** Merge a later disk rescan without inventing contradictory attempted flags. */
export function mergeEvidenceStateFromDisk(options: {
  prior: Tender247EvidenceState | null;
  t247Id: string;
  metadataAvailable: boolean;
  aiAvailable: boolean;
  aiPath?: string;
  documentsAvailable: boolean;
  documentsPath?: string;
}): Tender247EvidenceState {
  const prior = options.prior;
  const metadataAttempted = prior?.metadata.attempted ?? options.metadataAvailable;
  const aiAttempted = prior?.aiSummary.attempted ?? options.aiAvailable;
  const documentsAttempted =
    prior?.documents.attempted ?? options.documentsAvailable;
  return buildFinalEvidenceState({
    t247Id: options.t247Id,
    metadataAttempted,
    metadataAvailable: options.metadataAvailable,
    metadataStatus: options.metadataAvailable
      ? "complete"
      : metadataAttempted
        ? prior?.metadata.status === "complete"
          ? "failed"
          : (prior?.metadata.status ?? "failed")
        : "not_attempted",
    aiAttempted,
    aiAvailable: options.aiAvailable,
    aiStatus: options.aiAvailable
      ? "complete"
      : aiAttempted
        ? prior?.aiSummary.status === "complete"
          ? "failed"
          : (prior?.aiSummary.status ?? "unavailable")
        : "not_attempted",
    aiPath: options.aiPath,
    documentsAttempted,
    documentsAvailable: options.documentsAvailable,
    documentsStatus: options.documentsAvailable
      ? "complete"
      : documentsAttempted
        ? prior?.documents.status === "complete"
          ? "failed"
          : (prior?.documents.status ?? "failed")
        : "not_attempted",
    documentsPath: options.documentsPath,
    downloadAllAttempted: prior?.documents.downloadAllAttempted ?? false,
    downloadAllSuccess: prior?.documents.downloadAllSuccess ?? false,
    individualFallbackUsed: prior?.documents.individualFallbackUsed ?? false,
    individualDocsFound: prior?.individualDocsFound,
    individualDocsSuccess: prior?.individualDocsSuccess,
    individualDocsFailed: prior?.individualDocsFailed,
    canonicalZipReady: prior?.canonicalZipReady,
  });
}
