/**
 * Tender247 Excel-stage early financial gate.
 * Pure rules only — no crawler / Supabase / ChatGPT side effects.
 */
import { parseInrAmount } from "../finance/parseInrAmount.js";
import { loadPrescreenConfig } from "../prescreen/prescreenConfig.js";

export type ExcelFilterStatus = "KEEP" | "DROP";

export type ExcelFilterReasonCode =
  | "TENDER_VALUE_ABOVE_LIMIT"
  | "EMD_ABOVE_LIMIT"
  | "BOTH_VALUE_AND_EMD_ABOVE_LIMIT"
  | "WITHIN_FINANCIAL_LIMITS"
  | "FINANCIAL_DATA_UNAVAILABLE_CONTINUE";

export type ExcelFinancialRowInput = {
  sourceTenderId: string;
  title: string;
  rawTenderValue: string | number | null | undefined;
  rawEmd: string | number | null | undefined;
  deadline?: string | null;
};

export type ExcelFilterDecision = {
  sourceTenderId: string;
  title: string;
  rawTenderValue: string | null;
  parsedTenderValueInr: number | null;
  rawEmd: string | null;
  parsedEmdInr: number | null;
  deadline: string | null;
  status: ExcelFilterStatus;
  reasonCode: ExcelFilterReasonCode;
  excelTenderValueUnavailable: boolean;
  excelEmdUnavailable: boolean;
};

export type ExcelEarlyFilterSummary = {
  excelRows: number;
  droppedByTenderValue: number;
  droppedByEmd: number;
  droppedByBoth: number;
  keptWithinLimits: number;
  keptBecauseUnavailable: number;
  detailCrawlsRequired: number;
  survivingTenderIds: string[];
  decisions: ExcelFilterDecision[];
};

const EMD_ZERO_SEMANTICS_RE =
  /^(not\s+required|nil|n\.?\s*i\.?\s*l\.?|exempt(?:ed)?)$/i;

const UNAVAILABLE_PLACEHOLDER_RE =
  /^(?:-|—|–|n\/?a|na|not\s+(?:available|disclosed|applicable)|refer\s+documents?|refer\s+docs?|as\s+per\s+(?:rfp|tender(?:\s+document)?)|see\s+(?:the\s+)?documents?)$/i;

function rawToText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  const text = String(value).replace(/\u00a0/g, " ").trim();
  return text || null;
}

function isEmdZeroSemantics(text: string | null): boolean {
  if (!text) return false;
  return EMD_ZERO_SEMANTICS_RE.test(text.trim());
}

function isUnavailablePlaceholder(text: string | null): boolean {
  if (!text) return true;
  return UNAVAILABLE_PLACEHOLDER_RE.test(text.trim());
}

/**
 * Resolve Excel tender-value cell into numeric INR or unavailable.
 * Does not invent values.
 */
export function resolveExcelTenderValue(raw: unknown): {
  amountInr: number | null;
  unavailable: boolean;
  rawText: string | null;
} {
  const rawText = rawToText(raw);
  if (!rawText || isUnavailablePlaceholder(rawText)) {
    return { amountInr: null, unavailable: true, rawText: rawText };
  }

  // Plain Excel numerics (number or digit string) are valid INR amounts.
  const parsed = parseInrAmount(typeof raw === "number" ? raw : rawText);
  if (parsed.valid && parsed.amountInr != null) {
    return { amountInr: parsed.amountInr, unavailable: false, rawText };
  }

  return { amountInr: null, unavailable: true, rawText };
}

/**
 * Resolve Excel EMD cell. "Not Required" / Nil / Exempted → 0 INR (available).
 */
export function resolveExcelEmd(raw: unknown): {
  amountInr: number | null;
  unavailable: boolean;
  rawText: string | null;
} {
  const rawText = rawToText(raw);
  if (!rawText || isUnavailablePlaceholder(rawText)) {
    return { amountInr: null, unavailable: true, rawText: rawText };
  }

  if (isEmdZeroSemantics(rawText)) {
    return { amountInr: 0, unavailable: false, rawText };
  }

  const parsed = parseInrAmount(typeof raw === "number" ? raw : rawText);
  if (parsed.valid && parsed.amountInr != null) {
    return { amountInr: parsed.amountInr, unavailable: false, rawText };
  }

  return { amountInr: null, unavailable: true, rawText };
}

export function evaluateExcelFinancialGate(
  row: ExcelFinancialRowInput,
  thresholds?: { tenderValueMaxInr: number; tender247EmdMaxInr: number },
): ExcelFilterDecision {
  const config = thresholds ?? {
    tenderValueMaxInr: loadPrescreenConfig().tenderValueMaxInr,
    tender247EmdMaxInr: loadPrescreenConfig().tender247EmdMaxInr,
  };

  const value = resolveExcelTenderValue(row.rawTenderValue);
  const emd = resolveExcelEmd(row.rawEmd);

  const base = {
    sourceTenderId: row.sourceTenderId,
    title: row.title || "",
    rawTenderValue: value.rawText,
    parsedTenderValueInr: value.amountInr,
    rawEmd: emd.rawText,
    parsedEmdInr: emd.amountInr,
    deadline: row.deadline?.trim() || null,
    excelTenderValueUnavailable: value.unavailable,
    excelEmdUnavailable: emd.unavailable,
  };

  const valueOver =
    !value.unavailable &&
    value.amountInr != null &&
    value.amountInr > config.tenderValueMaxInr;
  const emdOver =
    !emd.unavailable &&
    emd.amountInr != null &&
    emd.amountInr > config.tender247EmdMaxInr;

  // Objective financial drops (strict > threshold; exact max KEEP).
  if (valueOver && emdOver) {
    return {
      ...base,
      status: "DROP",
      reasonCode: "BOTH_VALUE_AND_EMD_ABOVE_LIMIT",
    };
  }
  if (valueOver) {
    return {
      ...base,
      status: "DROP",
      reasonCode: "TENDER_VALUE_ABOVE_LIMIT",
    };
  }
  if (emdOver) {
    return {
      ...base,
      status: "DROP",
      reasonCode: "EMD_ABOVE_LIMIT",
    };
  }

  if (value.unavailable && emd.unavailable) {
    return {
      ...base,
      status: "KEEP",
      reasonCode: "FINANCIAL_DATA_UNAVAILABLE_CONTINUE",
    };
  }

  if (value.unavailable || emd.unavailable) {
    return {
      ...base,
      status: "KEEP",
      reasonCode: "FINANCIAL_DATA_UNAVAILABLE_CONTINUE",
    };
  }

  return {
    ...base,
    status: "KEEP",
    reasonCode: "WITHIN_FINANCIAL_LIMITS",
  };
}

export function applyExcelEarlyFinancialFilter(
  rows: ExcelFinancialRowInput[],
  thresholds?: { tenderValueMaxInr: number; tender247EmdMaxInr: number },
): ExcelEarlyFilterSummary {
  const decisions = rows.map((row) =>
    evaluateExcelFinancialGate(row, thresholds),
  );

  let droppedByTenderValue = 0;
  let droppedByEmd = 0;
  let droppedByBoth = 0;
  let keptWithinLimits = 0;
  let keptBecauseUnavailable = 0;
  const survivingTenderIds: string[] = [];

  for (const d of decisions) {
    if (d.status === "DROP") {
      if (d.reasonCode === "TENDER_VALUE_ABOVE_LIMIT") {
        droppedByTenderValue += 1;
      } else if (d.reasonCode === "EMD_ABOVE_LIMIT") {
        droppedByEmd += 1;
      } else if (d.reasonCode === "BOTH_VALUE_AND_EMD_ABOVE_LIMIT") {
        droppedByBoth += 1;
      }
      continue;
    }
    survivingTenderIds.push(d.sourceTenderId);
    if (d.reasonCode === "FINANCIAL_DATA_UNAVAILABLE_CONTINUE") {
      keptBecauseUnavailable += 1;
    } else {
      keptWithinLimits += 1;
    }
  }

  return {
    excelRows: rows.length,
    droppedByTenderValue,
    droppedByEmd,
    droppedByBoth,
    keptWithinLimits,
    keptBecauseUnavailable,
    detailCrawlsRequired: survivingTenderIds.length,
    survivingTenderIds,
    decisions,
  };
}

/**
 * Compact INR display for Excel review sheets (not used for filtering).
 * 40392530 → ₹4.04 Cr ; 1600000 → ₹16.00 L
 */
export function formatInrReviewDisplay(
  amountInr: number | null | undefined,
): string {
  if (amountInr == null || !Number.isFinite(amountInr)) {
    return "";
  }
  const abs = Math.abs(amountInr);
  const sign = amountInr < 0 ? "-" : "";
  if (abs >= 10_000_000) {
    return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  }
  if (abs >= 100_000) {
    return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  }
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * True when a live Fresh-list card may open detail / download / Supabase.
 * Excel DROP IDs and IDs absent from the Excel KEEP set must never proceed.
 */
export function shouldDetailCrawlExcelSurvivor(
  t247Id: string,
  survivingTenderIds: ReadonlySet<string>,
): boolean {
  return survivingTenderIds.has(t247Id);
}

export function printExcelEarlyFilterSummary(
  summary: ExcelEarlyFilterSummary,
  extras?: {
    supabaseCandidates?: number;
    chatgptEligible?: number;
  },
): void {
  console.log("");
  console.log("========================================");
  console.log("Tender247 Daily Excel Financial Filter");
  console.log("========================================");
  console.log(`Excel rows: ${summary.excelRows}`);
  console.log(`Dropped by tender value: ${summary.droppedByTenderValue}`);
  console.log(`Dropped by EMD: ${summary.droppedByEmd}`);
  console.log(`Dropped by both: ${summary.droppedByBoth}`);
  console.log(
    `Financial drop unique: ${
      summary.droppedByTenderValue +
      summary.droppedByEmd +
      summary.droppedByBoth
    }`,
  );
  console.log(`Kept within limits: ${summary.keptWithinLimits}`);
  console.log(
    `Kept because amount unavailable: ${summary.keptBecauseUnavailable}`,
  );
  console.log(`Detail crawls required: ${summary.detailCrawlsRequired}`);
  console.log(
    `FINANCIAL_DROP_UNIQUE=${
      summary.droppedByTenderValue +
      summary.droppedByEmd +
      summary.droppedByBoth
    }`,
  );
  console.log(`FINANCIAL_SURVIVORS=${summary.detailCrawlsRequired}`);
  if (extras?.supabaseCandidates != null) {
    console.log(`Supabase candidates: ${extras.supabaseCandidates}`);
  }
  if (extras?.chatgptEligible != null) {
    console.log(`ChatGPT eligible: ${extras.chatgptEligible}`);
  }
  console.log("========================================");
  console.log("");
}
