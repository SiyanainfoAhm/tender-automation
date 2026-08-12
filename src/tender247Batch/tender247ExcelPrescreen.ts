/**
 * Tender247 Excel-stage deterministic pre-screen (before detail crawl / ChatGPT).
 *
 * Drops only clear failures:
 *   - EMD > ₹15,00,000
 *   - Tender value / estimated cost > ₹5 Crore
 *   - Clear EOI / Empanelment / scanning-primary / internet / non-IT title scope
 *   - Closing date already non-actionable (past or today Asia/Kolkata)
 *
 * Missing financial / PQ / deadline data → pass forward (never false NO_GO).
 */
import fs from "node:fs";
import path from "node:path";
import { parsePortalDate } from "../supabase/tenderMetadataMap.js";
import { getIndiaTodayIsoDate } from "../dateUtils.js";
import { ensureDir } from "../fileUtils.js";
import { loadPrescreenConfig } from "../prescreen/prescreenConfig.js";
import {
  evaluateTender247ItRelevance,
  type Tender247ItRelevance,
} from "../prescreen/tender247ItRelevanceClassifier.js";
import {
  evaluateExcelFinancialGate,
  type ExcelFinancialRowInput,
} from "./excelEarlyFinancialFilter.js";

export type Tender247PrescreenReason =
  | "FILTER_EMD_EXCEEDED"
  | "FILTER_VALUE_EXCEEDED"
  | "FILTER_EOI"
  | "FILTER_EMPANELMENT"
  | "FILTER_SCANNING_DIGITIZATION"
  | "FILTER_INTERNET_SERVICE"
  | "FILTER_NON_IT"
  | "FILTER_DEADLINE_NOT_ACTIONABLE"
  | "PASSED";

export type Tender247PrescreenResult = {
  passed: boolean;
  reasons: Tender247PrescreenReason[];
  matchedRules: string[];
  normalizedEmd?: number | null;
  normalizedTenderValue?: number | null;
  itRelevant?: boolean | null;
  itRelevance?: Tender247ItRelevance | null;
  deadlineIso?: string | null;
};

export type Tender247PrescreenCandidate = ExcelFinancialRowInput & {
  source?: "TENDER247";
  organization?: string | null;
  category?: string | null;
  location?: string | null;
  tenderReference?: string | null;
  publishDate?: string | null;
  sourceDate?: string | null;
  detailUrl?: string | null;
};

export type Tender247PrescreenRow = Tender247PrescreenCandidate & {
  filterStatus: "PASSED" | "DROPPED";
  filterResult: Tender247PrescreenResult;
};

export type Tender247PrescreenSummary = {
  requestedDate: string;
  dailyRowsRaw: number;
  dailyRowsDeduped: number;
  duplicatesRemoved: number;
  filterInputCount: number;
  filterDropEmd: number;
  filterDropValue: number;
  filterDropEoi: number;
  filterDropEmpanelment: number;
  filterDropScanning: number;
  filterDropInternetService: number;
  filterDropNonIt: number;
  filterDropDeadline: number;
  filterPassed: number;
  survivingTenderIds: string[];
  rows: Tender247PrescreenRow[];
};

const EOI_RE = /\b(eoi|expression\s+of\s+interest)\b/i;
const EMPANELMENT_RE = /\bempanelment\b/i;
const INTERNET_RE =
  /\b(internet\s+(service|connectivity|lease|leased\s+line)|bandwidth|leased\s+line|isp\s+services?)\b/i;
/** Primary scanning / record conversion — not software digitization platforms. */
const SCANNING_PRIMARY_RE =
  /\b(bulk\s+scanning|document\s+scanning|scanning\s+and\s+digitization|scanning\s+and\s+digitisation|scanning\s+of\s+(legacy\s+)?(records?|documents?)|digitization\s+of\s+(legacy\s+)?(records?|documents?)|digitisation\s+of\s+(legacy\s+)?(records?|documents?))\b/i;
const SOFTWARE_OVERRIDE_RE =
  /\b(software|application|portal|platform\s+development|web\s+application|website\s+development|mobile\s+app)\b/i;

function uniqueReasons(
  reasons: Tender247PrescreenReason[],
): Tender247PrescreenReason[] {
  return [...new Set(reasons)];
}

/**
 * Title/brief scope exclusions that are safe to apply from Excel alone.
 */
export function evaluateExcelScopeExclusions(title: string): {
  reasons: Tender247PrescreenReason[];
  matchedRules: string[];
  itRelevant: boolean | null;
  itRelevance: Tender247ItRelevance | null;
} {
  const text = (title || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return {
      reasons: [],
      matchedRules: [],
      itRelevant: null,
      itRelevance: null,
    };
  }

  const reasons: Tender247PrescreenReason[] = [];
  const matchedRules: string[] = [];

  if (EOI_RE.test(text)) {
    reasons.push("FILTER_EOI");
    matchedRules.push("EOI");
  }
  if (EMPANELMENT_RE.test(text)) {
    reasons.push("FILTER_EMPANELMENT");
    matchedRules.push("Empanelment");
  }
  if (INTERNET_RE.test(text)) {
    reasons.push("FILTER_INTERNET_SERVICE");
    matchedRules.push("Internet/bandwidth");
  }

  // Scanning-primary only when not clearly a software/platform deliverable.
  if (SCANNING_PRIMARY_RE.test(text) && !SOFTWARE_OVERRIDE_RE.test(text)) {
    reasons.push("FILTER_SCANNING_DIGITIZATION");
    matchedRules.push("Scanning/digitization-primary");
  } else if (
    /\b(scanning|digitization|digitisation)\b/i.test(text) &&
    !SOFTWARE_OVERRIDE_RE.test(text) &&
    !/\b(platform|software|application|portal|development)\b/i.test(text)
  ) {
    // Generic scanning/digitization without software override.
    reasons.push("FILTER_SCANNING_DIGITIZATION");
    matchedRules.push("Scanning/digitization");
  }

  const it = evaluateTender247ItRelevance(text);
  let itRelevant: boolean | null = null;
  if (it.relevance === "IT_RELEVANT") {
    itRelevant = true;
  } else if (it.relevance === "NON_IT") {
    itRelevant = false;
    // Only drop clear non-IT when no other more specific exclusion already hit.
    if (reasons.length === 0) {
      reasons.push("FILTER_NON_IT");
      matchedRules.push(it.reasonCode);
    }
  } else {
    itRelevant = null; // ambiguous / insufficient → pass forward
  }

  return {
    reasons: uniqueReasons(reasons),
    matchedRules,
    itRelevant,
    itRelevance: it.relevance,
  };
}

export function evaluateDeadlineActionable(
  deadlineRaw: string | null | undefined,
  businessDateIso: string,
): {
  actionable: boolean | null;
  deadlineIso: string | null;
  reason?: Tender247PrescreenReason;
} {
  const raw = deadlineRaw?.trim() || "";
  if (!raw) {
    return { actionable: null, deadlineIso: null };
  }
  const deadlineIso = parsePortalDate(raw);
  if (!deadlineIso) {
    return { actionable: null, deadlineIso: null };
  }
  // Same-day and past closing dates are non-actionable under current Siyana rule.
  if (deadlineIso <= businessDateIso) {
    return {
      actionable: false,
      deadlineIso,
      reason: "FILTER_DEADLINE_NOT_ACTIONABLE",
    };
  }
  return { actionable: true, deadlineIso };
}

export function evaluateTender247ExcelPrescreen(
  row: Tender247PrescreenCandidate,
  options?: {
    businessDateIso?: string;
    tenderValueMaxInr?: number;
    tender247EmdMaxInr?: number;
  },
): Tender247PrescreenResult {
  const config = loadPrescreenConfig();
  const businessDateIso =
    options?.businessDateIso ?? getIndiaTodayIsoDate();
  const thresholds = {
    tenderValueMaxInr:
      options?.tenderValueMaxInr ?? config.tenderValueMaxInr,
    tender247EmdMaxInr:
      options?.tender247EmdMaxInr ?? config.tender247EmdMaxInr,
  };

  const financial = evaluateExcelFinancialGate(row, thresholds);
  const scope = evaluateExcelScopeExclusions(row.title || "");
  const deadline = evaluateDeadlineActionable(row.deadline, businessDateIso);

  const reasons: Tender247PrescreenReason[] = [];
  const matchedRules: string[] = [];

  if (
    financial.reasonCode === "EMD_ABOVE_LIMIT" ||
    financial.reasonCode === "BOTH_VALUE_AND_EMD_ABOVE_LIMIT"
  ) {
    reasons.push("FILTER_EMD_EXCEEDED");
    matchedRules.push("EMD_ABOVE_LIMIT");
  }
  if (
    financial.reasonCode === "TENDER_VALUE_ABOVE_LIMIT" ||
    financial.reasonCode === "BOTH_VALUE_AND_EMD_ABOVE_LIMIT"
  ) {
    reasons.push("FILTER_VALUE_EXCEEDED");
    matchedRules.push("TENDER_VALUE_ABOVE_LIMIT");
  }

  for (const r of scope.reasons) {
    reasons.push(r);
  }
  matchedRules.push(...scope.matchedRules);

  if (deadline.reason) {
    reasons.push(deadline.reason);
    matchedRules.push("DEADLINE_NOT_ACTIONABLE");
  }

  const unique = uniqueReasons(reasons);
  const passed = unique.length === 0;
  if (passed) {
    return {
      passed: true,
      reasons: ["PASSED"],
      matchedRules,
      normalizedEmd: financial.parsedEmdInr,
      normalizedTenderValue: financial.parsedTenderValueInr,
      itRelevant: scope.itRelevant,
      itRelevance: scope.itRelevance,
      deadlineIso: deadline.deadlineIso,
    };
  }

  return {
    passed: false,
    reasons: unique,
    matchedRules,
    normalizedEmd: financial.parsedEmdInr,
    normalizedTenderValue: financial.parsedTenderValueInr,
    itRelevant: scope.itRelevant,
    itRelevance: scope.itRelevance,
    deadlineIso: deadline.deadlineIso,
  };
}

/**
 * Deduplicate by strongest available identity (Tender247 ID first).
 */
export function dedupeTender247Candidates(
  rows: Tender247PrescreenCandidate[],
): {
  deduped: Tender247PrescreenCandidate[];
  rawCount: number;
  duplicatesRemoved: number;
} {
  const byId = new Map<string, Tender247PrescreenCandidate>();
  for (const row of rows) {
    const id = String(row.sourceTenderId || "").replace(/\D/g, "") ||
      String(row.sourceTenderId || "").trim();
    if (!id) continue;
    if (!byId.has(id)) {
      byId.set(id, { ...row, sourceTenderId: id, source: "TENDER247" });
    }
  }
  const deduped = [...byId.values()];
  return {
    deduped,
    rawCount: rows.length,
    duplicatesRemoved: Math.max(0, rows.length - deduped.length),
  };
}

export function applyTender247ExcelPrescreen(
  rows: Tender247PrescreenCandidate[],
  options?: {
    businessDateIso?: string;
    tenderValueMaxInr?: number;
    tender247EmdMaxInr?: number;
  },
): Tender247PrescreenSummary {
  const businessDateIso =
    options?.businessDateIso ?? getIndiaTodayIsoDate();
  const { deduped, rawCount, duplicatesRemoved } =
    dedupeTender247Candidates(rows);

  let filterDropEmd = 0;
  let filterDropValue = 0;
  let filterDropEoi = 0;
  let filterDropEmpanelment = 0;
  let filterDropScanning = 0;
  let filterDropInternetService = 0;
  let filterDropNonIt = 0;
  let filterDropDeadline = 0;
  const survivingTenderIds: string[] = [];
  const outRows: Tender247PrescreenRow[] = [];

  for (const row of deduped) {
    const filterResult = evaluateTender247ExcelPrescreen(row, {
      businessDateIso,
      tenderValueMaxInr: options?.tenderValueMaxInr,
      tender247EmdMaxInr: options?.tender247EmdMaxInr,
    });

    const filterStatus = filterResult.passed ? "PASSED" : "DROPPED";
    outRows.push({ ...row, filterStatus, filterResult });

    if (filterResult.passed) {
      survivingTenderIds.push(row.sourceTenderId);
      continue;
    }

    // Count each dropped tender once per reason family (not once per reason string spam).
    const reasonSet = new Set(filterResult.reasons);
    if (reasonSet.has("FILTER_EMD_EXCEEDED")) filterDropEmd += 1;
    if (reasonSet.has("FILTER_VALUE_EXCEEDED")) filterDropValue += 1;
    if (reasonSet.has("FILTER_EOI")) filterDropEoi += 1;
    if (reasonSet.has("FILTER_EMPANELMENT")) filterDropEmpanelment += 1;
    if (reasonSet.has("FILTER_SCANNING_DIGITIZATION")) filterDropScanning += 1;
    if (reasonSet.has("FILTER_INTERNET_SERVICE")) {
      filterDropInternetService += 1;
    }
    if (reasonSet.has("FILTER_NON_IT")) filterDropNonIt += 1;
    if (reasonSet.has("FILTER_DEADLINE_NOT_ACTIONABLE")) {
      filterDropDeadline += 1;
    }
  }

  return {
    requestedDate: businessDateIso,
    dailyRowsRaw: rawCount,
    dailyRowsDeduped: deduped.length,
    duplicatesRemoved,
    filterInputCount: deduped.length,
    filterDropEmd,
    filterDropValue,
    filterDropEoi,
    filterDropEmpanelment,
    filterDropScanning,
    filterDropInternetService,
    filterDropNonIt,
    filterDropDeadline,
    filterPassed: survivingTenderIds.length,
    survivingTenderIds,
    rows: outRows,
  };
}

export function printTender247PrescreenCounts(
  summary: Tender247PrescreenSummary,
): void {
  console.log(`DAILY_ROWS_RAW=${summary.dailyRowsRaw}`);
  console.log(`DAILY_ROWS_DEDUPED=${summary.dailyRowsDeduped}`);
  console.log(`DUPLICATES_REMOVED=${summary.duplicatesRemoved}`);
  console.log(`FILTER_INPUT_COUNT=${summary.filterInputCount}`);
  console.log(`FILTER_DROP_EMD=${summary.filterDropEmd}`);
  console.log(`FILTER_DROP_VALUE=${summary.filterDropValue}`);
  console.log(`FILTER_DROP_EOI=${summary.filterDropEoi}`);
  console.log(`FILTER_DROP_EMPANELMENT=${summary.filterDropEmpanelment}`);
  console.log(`FILTER_DROP_SCANNING=${summary.filterDropScanning}`);
  console.log(
    `FILTER_DROP_INTERNET_SERVICE=${summary.filterDropInternetService}`,
  );
  console.log(`FILTER_DROP_NON_IT=${summary.filterDropNonIt}`);
  console.log(`FILTER_DROP_DEADLINE=${summary.filterDropDeadline}`);
  console.log(`FILTER_PASSED=${summary.filterPassed}`);
}

export function writeTender247PrescreenArtifacts(
  dateFolder: string,
  summary: Tender247PrescreenSummary,
): {
  prescreenJson: string;
  filteredOutCsv: string;
  candidatesJson: string;
} {
  ensureDir(dateFolder);
  const prescreenJson = path.join(dateFolder, "tender247-prescreen.json");
  const filteredOutCsv = path.join(dateFolder, "tender247-filtered-out.csv");
  const candidatesJson = path.join(dateFolder, "tender247-candidates.json");

  const payload = {
    generatedAt: new Date().toISOString(),
    requestedDate: summary.requestedDate,
    dailyRowsRaw: summary.dailyRowsRaw,
    dailyRowsDeduped: summary.dailyRowsDeduped,
    duplicatesRemoved: summary.duplicatesRemoved,
    filterCounts: {
      input: summary.filterInputCount,
      dropEmd: summary.filterDropEmd,
      dropValue: summary.filterDropValue,
      dropEoi: summary.filterDropEoi,
      dropEmpanelment: summary.filterDropEmpanelment,
      dropScanning: summary.filterDropScanning,
      dropInternetService: summary.filterDropInternetService,
      dropNonIt: summary.filterDropNonIt,
      dropDeadline: summary.filterDropDeadline,
      passed: summary.filterPassed,
    },
    tenders: summary.rows.map((r) => ({
      source: r.source ?? "TENDER247",
      sourceTenderId: r.sourceTenderId,
      tenderName: r.title,
      organization: r.organization ?? null,
      closingDate: r.deadline ?? null,
      tenderValue: r.rawTenderValue ?? null,
      emd: r.rawEmd ?? null,
      category: r.category ?? null,
      location: r.location ?? null,
      sourceDate: r.sourceDate ?? summary.requestedDate,
      filterStatus: r.filterStatus,
      filterReasons: r.filterResult.reasons,
      matchedRules: r.filterResult.matchedRules,
      normalizedEmd: r.filterResult.normalizedEmd ?? null,
      normalizedTenderValue: r.filterResult.normalizedTenderValue ?? null,
      itRelevant: r.filterResult.itRelevant ?? null,
    })),
    survivingTenderIds: summary.survivingTenderIds,
  };
  fs.writeFileSync(prescreenJson, JSON.stringify(payload, null, 2), "utf8");

  const dropped = summary.rows.filter((r) => r.filterStatus === "DROPPED");
  const csvEscape = (v: string): string => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const csvLines = [
    "Tender247 ID,Tender Name,Filter Status,Filter Reason",
    ...dropped.map((r) =>
      [
        r.sourceTenderId,
        csvEscape(r.title || ""),
        r.filterStatus,
        csvEscape(r.filterResult.reasons.join("|")),
      ].join(","),
    ),
  ];
  fs.writeFileSync(filteredOutCsv, csvLines.join("\n"), "utf8");

  const candidates = summary.rows
    .filter((r) => r.filterStatus === "PASSED")
    .map((r) => ({
      source: "TENDER247" as const,
      sourceTenderId: r.sourceTenderId,
      tenderName: r.title,
      organization: r.organization ?? null,
      closingDate: r.deadline ?? null,
      tenderValue: r.rawTenderValue ?? null,
      emd: r.rawEmd ?? null,
      sourceDate: summary.requestedDate,
      filterResult: r.filterResult,
    }));
  fs.writeFileSync(
    candidatesJson,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        requestedDate: summary.requestedDate,
        count: candidates.length,
        candidates,
      },
      null,
      2,
    ),
    "utf8",
  );

  return { prescreenJson, filteredOutCsv, candidatesJson };
}
