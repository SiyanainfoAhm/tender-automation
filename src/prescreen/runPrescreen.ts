import type { Logger } from "../logger.js";
import type { BidassistMetadata } from "../bidassist/bidassistTypes.js";
import type { CompleteTenderMetadata } from "../tender247Batch/extractCompleteMetadata.js";
import { evaluatePrescreen } from "./prescreenRuleEngine.js";
import { loadPrescreenConfig } from "./prescreenConfig.js";
import {
  logPrescreenDecision,
  persistPrescreenResult,
} from "./prescreenRepository.js";
import type {
  PrescreenDecision,
  PrescreenInput,
  PrescreenSourcePortal,
} from "./prescreenTypes.js";

export function buildTender247PrescreenInput(
  metadata: CompleteTenderMetadata,
): PrescreenInput {
  const normalized = metadata.normalized || {};
  const asString = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text : null;
  };
  const asNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  };
  return {
    sourcePortal: "TENDER247",
    sourceTenderId: String(metadata.t247Id),
    title: asString(normalized.tenderName) || String(metadata.t247Id || ""),
    category: asString(normalized.category),
    description:
      asString(normalized.description) || asString(normalized.brief),
    closingDate: asString(normalized.closingDate),
    tenderValue: asNumber(normalized.tenderValue),
    tenderValueText: asString(metadata.raw?.["Tender Estimated Cost"]),
    emdAmount: asNumber(normalized.emdAmount),
    emdText:
      asString(metadata.raw?.EMD) || asString(metadata.aiSummary?.["EMD Amount"]),
    documentArchiveAvailable: Boolean(
      metadata.downloads?.allDocumentsDownloaded,
    ),
    hasNormalizedMetadata: true,
  };
}

export function buildBidassistPrescreenInput(
  metadata: BidassistMetadata,
  documentArchiveAvailable: boolean,
): PrescreenInput {
  const normalized =
    metadata.normalized && typeof metadata.normalized === "object"
      ? (metadata.normalized as Record<string, unknown>)
      : {};
  return {
    sourcePortal: "BIDASSIST",
    sourceTenderId: String(metadata.bidassistId),
    title: String(
      normalized.title || metadata.title || metadata.bidassistId || "",
    ),
    category: (normalized.category as string) || metadata.category || null,
    description:
      (normalized.description as string) || metadata.description || null,
    closingDate:
      (normalized.closingDate as string) || metadata.closingDate || null,
    tenderValue:
      typeof normalized.tenderValue === "number"
        ? (normalized.tenderValue as number)
        : typeof metadata.tenderValue === "number"
          ? metadata.tenderValue
          : null,
    tenderValueText:
      (normalized.tenderValueText as string) ||
      metadata.tenderValueText ||
      metadata.tenderAmountText ||
      null,
    emdAmount:
      typeof normalized.emdAmount === "number"
        ? (normalized.emdAmount as number)
        : typeof metadata.emdAmount === "number"
          ? metadata.emdAmount
          : null,
    emdText: (normalized.emdText as string) || metadata.emdText || null,
    documentArchiveAvailable,
    hasNormalizedMetadata: true,
  };
}

export async function runAndPersistPrescreen(options: {
  tenderId: string;
  sourcePortal: PrescreenSourcePortal;
  sourceTenderId: string;
  input: PrescreenInput;
  metadataHash?: string | null;
  logger: Logger | { info: (msg: string) => void; warn?: (msg: string) => void };
}): Promise<{ ok: boolean; decision: PrescreenDecision; error: string | null }> {
  const config = loadPrescreenConfig();
  const decision = evaluatePrescreen(options.input, config);
  logPrescreenDecision(
    options.logger,
    options.sourcePortal,
    options.sourceTenderId,
    decision,
  );

  const persisted = await persistPrescreenResult({
    tenderId: options.tenderId,
    decision,
    sourcePortal: options.sourcePortal,
    sourceTenderId: options.sourceTenderId,
    metadataHash: options.metadataHash,
  });

  if (!persisted.ok) {
    options.logger.warn?.(
      `PRESCREEN_PERSIST_FAILED=${persisted.error}`,
    );
  }

  return {
    ok: persisted.ok,
    decision,
    error: persisted.error,
  };
}
