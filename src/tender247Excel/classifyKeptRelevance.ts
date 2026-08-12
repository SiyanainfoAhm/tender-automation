/**
 * Open Tender247 detail via production single-tender resolver, extract cheap
 * metadata, classify IT relevance — NO document downloads.
 */
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { extractCompleteTenderMetadata } from "../tender247Batch/extractCompleteMetadata.js";
import { resolveTender247Tender } from "../tender247Batch/resolveTender247Tender.js";
import { evaluateTender247ItRelevanceFromMetadata } from "../tender247Batch/tender247ItRelevanceGate.js";
import {
  evaluateTender247ItRelevance,
  type Tender247ItRelevanceResult,
} from "../prescreen/tender247ItRelevanceClassifier.js";
import { sanitizeT247Id } from "../tenderDetails/tenderFolder.js";
import type { KeptExcelCandidate } from "./parseKeptExcelRows.js";
import type { RelevanceScanRecord } from "./selectItRelevantCandidates.js";

const METADATA_EXTRACTION_TIMEOUT_MS = 25_000;

export async function classifyKeptCandidateRelevance(options: {
  listPage: Page;
  context: BrowserContext;
  candidate: KeptExcelCandidate;
  config: AppConfig;
  logger: Logger;
}): Promise<RelevanceScanRecord> {
  const { listPage, context, candidate, config, logger } = options;
  const t247Id = sanitizeT247Id(candidate.sourceTenderId);

  const titleGate = evaluateTender247ItRelevance(candidate.title, {
    evidenceFields: ["excelTitle"],
  });

  let detailPage: Page | null = null;
  try {
    const resolved = await resolveTender247Tender({
      listPage,
      context,
      tenderId: t247Id,
      config,
      logger,
    });
    detailPage = resolved.detailPage;

    const metadata = await extractCompleteTenderMetadata({
      detailPage,
      t247Id,
      detailUrl: resolved.detailUrl,
      titleHint: candidate.title || resolved.item.listTitle,
      apiDetailRow: {},
      logger,
      deadlineMs: Date.now() + METADATA_EXTRACTION_TIMEOUT_MS,
    });

    let gate = evaluateTender247ItRelevanceFromMetadata(metadata);
    if (gate.relevance === "AMBIGUOUS" && gate.reasonCode === "EMPTY_SCOPE") {
      gate = titleGate;
    }

    return toScanRecord(candidate, gate, {
      detailOpened: true,
      detailResolved: true,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`TENDER247_DETAIL_RESOLVE_FAILED=${t247Id}`);
    logger.warn(`RELEVANCE_SCAN_ERROR=T247-${t247Id} ${message}`);
    // Do not force NON_IT — skip toward limit; record for local review
    const fallback: Tender247ItRelevanceResult = {
      relevance: "AMBIGUOUS",
      reasonCode: "INSUFFICIENT_SCOPE_EVIDENCE",
      matchedTerms: [],
      negativeTerms: [],
      evidenceFields: ["excelTitle"],
      explanation: `Detail resolve failed: ${message}`,
    };
    return toScanRecord(candidate, fallback, {
      detailOpened: false,
      detailResolved: false,
      error: message,
    });
  } finally {
    if (detailPage && !detailPage.isClosed()) {
      await detailPage.close({ runBeforeUnload: false }).catch(() => undefined);
    }
    for (const p of context.pages()) {
      if (p !== listPage && !p.isClosed()) {
        await p.close({ runBeforeUnload: false }).catch(() => undefined);
      }
    }
    await listPage.bringToFront().catch(() => undefined);
  }
}

function toScanRecord(
  candidate: KeptExcelCandidate,
  gate: Tender247ItRelevanceResult,
  meta: {
    detailOpened: boolean;
    detailResolved: boolean;
    error: string | null;
  },
): RelevanceScanRecord {
  return {
    candidate,
    relevance: gate.relevance,
    reasonCode: gate.reasonCode,
    matchedTerms: gate.matchedTerms,
    negativeTerms: gate.negativeTerms,
    evidenceFields: gate.evidenceFields,
    explanation: gate.explanation,
    candidateOrdinal: null,
    detailOpened: meta.detailOpened,
    detailResolved: meta.detailResolved,
    error: meta.error,
  };
}
