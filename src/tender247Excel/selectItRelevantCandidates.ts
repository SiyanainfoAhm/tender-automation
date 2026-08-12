/**
 * Select first N IT_RELEVANT financial survivors for downstream processing.
 * NON_IT / AMBIGUOUS never count toward the limit.
 */
import type { Tender247ItRelevance } from "../prescreen/tender247ItRelevanceClassifier.js";
import type { KeptExcelCandidate } from "./parseKeptExcelRows.js";

export type RelevanceScanRecord = {
  candidate: KeptExcelCandidate;
  relevance: Tender247ItRelevance;
  reasonCode: string;
  matchedTerms: string[];
  negativeTerms: string[];
  evidenceFields: string[];
  explanation?: string;
  /** Set when this IT_RELEVANT row was selected for downstream (1-based). */
  candidateOrdinal: number | null;
  detailOpened: boolean;
  /** false when openSingleTenderDirectly / detail resolve failed */
  detailResolved: boolean;
  error: string | null;
};

/**
 * Pure selection: keep only IT_RELEVANT, in scan order, up to `limit`.
 */
export function selectFirstItRelevantCandidates(
  scan: RelevanceScanRecord[],
  limit: number,
): RelevanceScanRecord[] {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`Invalid limit=${limit}`);
  }
  const selected: RelevanceScanRecord[] = [];
  for (const row of scan) {
    if (row.relevance !== "IT_RELEVANT") continue;
    selected.push({
      ...row,
      candidateOrdinal: selected.length + 1,
    });
    if (selected.length >= limit) break;
  }
  return selected;
}

/**
 * Intersection helper: financial KEEP ids ∩ IT_RELEVANT.
 */
export function filterItRelevantWithinFinancialKeep(
  scan: RelevanceScanRecord[],
  financialIds: Set<string>,
): RelevanceScanRecord[] {
  return scan.filter(
    (r) =>
      r.relevance === "IT_RELEVANT" &&
      financialIds.has(r.candidate.sourceTenderId),
  );
}
