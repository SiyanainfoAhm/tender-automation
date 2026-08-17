/**
 * Qualification input fingerprint — used only for resume skip decisions.
 * Fresh runs must never silently reuse qualifications based on this alone.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  findTenderAllDocumentsZip,
  hasMetadataForChatGpt,
  tryResolvePhase1TenderUploadFiles,
} from "./readiness.js";

export const QUALIFICATION_INPUT_PROMPT_VERSION = "tender247-qualify-v1";
export const QUALIFICATION_COMPANY_VERSION = "siyana-credentials-v1";

export type QualificationInputFingerprint = {
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  metadataHash: string | null;
  documentZipPath: string | null;
  documentZipExists: boolean;
  documentZipSize: number | null;
  documentZipHash: string | null;
  aiSummaryHash: string | null;
  aiSummaryAvailable: boolean;
  promptVersion: string;
  companyVersion: string;
  /** Canonical hash of the fields above. */
  qualificationInputHash: string;
};

function sha256File(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
      return null;
    }
    return crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");
  } catch {
    return null;
  }
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function resolveMetadataHash(tenderFolder: string): string | null {
  const legacyMeta = path.join(tenderFolder, "metadata.json");
  const legacyHash = sha256File(legacyMeta);
  if (legacyHash) return legacyHash;

  const marker = path.join(tenderFolder, "metadata.supabase-sync.json");
  if (fs.existsSync(marker) && fs.statSync(marker).size > 0) {
    try {
      const raw = fs.readFileSync(marker, "utf8");
      return sha256Text(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export function computeQualificationInputFingerprint(options: {
  dateFolder: string;
  sourceTenderId: string;
  sourcePortal?: "TENDER247" | "BIDASSIST";
}): QualificationInputFingerprint {
  const sourcePortal = options.sourcePortal ?? "TENDER247";
  const sourceTenderId = options.sourceTenderId.replace(/^T247-/i, "").trim();
  const tenderFolder = path.join(
    options.dateFolder,
    sourcePortal === "BIDASSIST" ? `BA-${sourceTenderId}` : `T247-${sourceTenderId}`,
  );

  const resolved = tryResolvePhase1TenderUploadFiles(
    options.dateFolder,
    sourceTenderId,
  );
  const documentsDir = path.join(tenderFolder, "documents");
  const fallbackZip = path.join(documentsDir, "Tender_All_Documents.zip");
  const zipPath =
    resolved?.documentZipPath ??
    findTenderAllDocumentsZip(tenderFolder) ??
    (fs.existsSync(fallbackZip) ? fallbackZip : null);
  let documentZipSize: number | null = null;
  let documentZipHash: string | null = null;
  let documentZipExists = false;
  if (zipPath && fs.existsSync(zipPath)) {
    try {
      documentZipSize = fs.statSync(zipPath).size;
      documentZipExists = documentZipSize > 0;
      documentZipHash = sha256File(zipPath);
    } catch {
      documentZipExists = false;
    }
  }

  const aiSummaryPath =
    resolved?.aiSummaryPath ?? path.join(tenderFolder, "AI_Summary.pdf");
  const aiSummaryHash = sha256File(aiSummaryPath);
  const metadataHash = resolveMetadataHash(tenderFolder);

  const payload = {
    sourcePortal,
    sourceTenderId,
    metadataHash,
    documentZipHash,
    documentZipSize,
    aiSummaryHash,
    promptVersion: QUALIFICATION_INPUT_PROMPT_VERSION,
    companyVersion: QUALIFICATION_COMPANY_VERSION,
  };

  const qualificationInputHash = sha256Text(JSON.stringify(payload));

  return {
    sourcePortal,
    sourceTenderId,
    metadataHash,
    documentZipPath: zipPath,
    documentZipExists,
    documentZipSize,
    documentZipHash,
    aiSummaryHash,
    aiSummaryAvailable: Boolean(aiSummaryHash),
    promptVersion: QUALIFICATION_INPUT_PROMPT_VERSION,
    companyVersion: QUALIFICATION_COMPANY_VERSION,
    qualificationInputHash,
  };
}

export function qualificationInputHashPath(tenderFolder: string): string {
  return path.join(tenderFolder, "qualification-input-hash.json");
}

export function loadStoredQualificationInputHash(
  tenderFolder: string,
): string | null {
  const filePath = qualificationInputHashPath(tenderFolder);
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
        qualificationInputHash?: string;
      };
      if (parsed.qualificationInputHash?.trim()) {
        return parsed.qualificationInputHash.trim();
      }
    } catch {
      // fall through
    }
  }

  const statePath = path.join(tenderFolder, "chatgpt-state.json");
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
        qualificationInputHash?: string;
      };
      if (state.qualificationInputHash?.trim()) {
        return state.qualificationInputHash.trim();
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function saveQualificationInputFingerprint(
  tenderFolder: string,
  fingerprint: QualificationInputFingerprint,
): void {
  fs.mkdirSync(tenderFolder, { recursive: true });
  fs.writeFileSync(
    qualificationInputHashPath(tenderFolder),
    JSON.stringify(
      {
        ...fingerprint,
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

export function logDocumentZipFingerprint(
  fingerprint: QualificationInputFingerprint,
  logger?: { info: (msg: string) => void },
): void {
  const lines = [
    `CHATGPT_DOCUMENT_ZIP_PATH=${fingerprint.documentZipPath ?? ""}`,
    `CHATGPT_DOCUMENT_ZIP_EXISTS=${fingerprint.documentZipExists}`,
    `CHATGPT_DOCUMENT_ZIP_SIZE=${fingerprint.documentZipSize ?? 0}`,
    `CHATGPT_DOCUMENT_ZIP_HASH=${fingerprint.documentZipHash ?? ""}`,
  ];
  for (const line of lines) {
    console.log(line);
    logger?.info(line);
  }
}

/** Metadata + ZIP required; AI Summary optional. */
export function hasRequiredQualificationInputs(options: {
  dateFolder: string;
  sourceTenderId: string;
}): boolean {
  return Boolean(
    tryResolvePhase1TenderUploadFiles(
      options.dateFolder,
      options.sourceTenderId,
    ) &&
      hasMetadataForChatGpt({
        dateFolder: options.dateFolder,
        t247Id: options.sourceTenderId,
      }),
  );
}
