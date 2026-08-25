/**
 * Multi-layout historical workbook parser.
 * Supports headered + headerless sheets used in Final_*_Aug analysis workbooks.
 */
import fs from "node:fs";
import XLSX from "xlsx";
import {
  parseDatesFromSheetName,
  shouldSkipSheet,
} from "./excelSheetMeta.js";
import {
  cleanText,
  digitsT247,
  normalizeCurrencyAmount,
  normalizeHistoricalStatus,
  parseExemptionFlag,
  toIsoDateOnly,
} from "./normalizeHistoricalTender.js";
import type { Phase1ScreeningStatus } from "../runScreening/phase1Statuses.js";

export type HistoricalTenderRow = {
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  folderId: string | null;
  title: string;
  organization: string | null;
  locationText: string | null;
  closingDate: string | null;
  tenderValue: number | null;
  tenderValueText: string | null;
  emdAmount: number | null;
  emdText: string | null;
  qualificationStatus: Phase1ScreeningStatus;
  screeningReason: string;
  tenderCategory: string | null;
  msmeExemption: boolean | null;
  startupExemption: boolean | null;
  /** Batch / screening date for scraped_date */
  scrapedDate: string;
  excelSheetName: string;
  sheetDates: string[];
  rowIndex: number;
};

export type SheetParseResult = {
  sheetName: string;
  skipped: boolean;
  skipReason: string | null;
  sheetDates: string[];
  rowsRead: number;
  validRows: HistoricalTenderRow[];
  invalidRows: Array<{ rowIndex: number; reason: string }>;
};

function headerMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = cleanText(h).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

function pick(
  map: Map<string, number>,
  cells: unknown[],
  aliases: string[],
): unknown {
  for (const alias of aliases) {
    const key = alias.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const idx = map.get(key);
    if (idx != null && idx < cells.length) {
      const v = cells[idx];
      if (v != null && String(v).trim() !== "") return v;
    }
  }
  // fuzzy contains
  for (const [key, idx] of map) {
    for (const alias of aliases) {
      const a = alias.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (key === a || key.includes(a) || a.includes(key)) {
        const v = cells[idx];
        if (v != null && String(v).trim() !== "") return v;
      }
    }
  }
  return "";
}

const T247_ALIASES = [
  "t247 id",
  "t247 id2",
  "t247id",
  "tender247 id",
  "tender 247 id",
  "tender id",
  "tender247 id",
];
const PORTAL_ALIASES = ["portal", "portal type", "source"];
const REF_ALIASES = ["reference no", "reference no.", "reference number", "ref no"];
const BRIEF_ALIASES = [
  "tender brief",
  "tender name",
  "title",
  "brief",
];
const VALUE_ALIASES = [
  "estimated value",
  "tender value",
  "tender value ",
  "value",
];
const DEADLINE_ALIASES = ["deadline", "closing date", "bid submission date"];
const LOCATION_ALIASES = ["location"];
const EMD_ALIASES = ["emd", "emd ", "emd amount"];
const STATUS_ALIASES = [
  "status",
  "final status",
  "screening category",
  "screening status",
];
const REASON_ALIASES = [
  "decision reason",
  "reason",
  "tender specific reason",
  "tender-specific reason",
];
const CATEGORY_ALIASES = ["tender category", "category", "screening category"];
const MSME_ALIASES = ["msme exemption", "msme"];
const STARTUP_ALIASES = ["startup exemption", "startup"];
const ORG_ALIASES = ["organization", "organisation", "authority"];
const ROW_DATE_ALIASES = ["screening date", "date", "batch date", "source date"];

function looksLikeHeaderRow(cells: unknown[]): boolean {
  const joined = cells
    .slice(0, 8)
    .map((c) => String(c ?? "").toLowerCase())
    .join(" ");
  return /t247|tender\s*brief|tender\s*name|estimated\s*value|screening\s*date|final\s*status|priority/.test(
    joined,
  );
}

function portalFromCell(raw: unknown): "TENDER247" | "BIDASSIST" {
  const text = cleanText(raw);
  if (/bidassist/i.test(text) && !/tender247/i.test(text)) return "BIDASSIST";
  return "TENDER247";
}

function resolveStatus(cells: unknown[], map: Map<string, number> | null): Phase1ScreeningStatus | null {
  if (map) {
    const primary = normalizeHistoricalStatus(pick(map, cells, STATUS_ALIASES));
    if (primary) return primary;
    const alt = normalizeHistoricalStatus(
      pick(map, cells, ["screening category", "it relevance"]),
    );
    if (alt) return alt;
    return null;
  }
  // headerless positional: try common status slots
  for (const idx of [12, 11, 10, 9, 8]) {
    const s = normalizeHistoricalStatus(cells[idx]);
    if (s) return s;
  }
  return null;
}

function buildRow(options: {
  cells: unknown[];
  map: Map<string, number> | null;
  sheetName: string;
  sheetDates: string[];
  rowIndex: number;
  layout: "headered" | "headerless_t247" | "headerless_date_t247" | "headerless_date_portal_t247";
}): HistoricalTenderRow | { invalid: string } {
  const { cells, map, sheetName, sheetDates, rowIndex, layout } = options;

  let t247 = "";
  let portalRaw: unknown = "";
  let ref = "";
  let brief = "";
  let valueRaw: unknown = "";
  let deadlineRaw: unknown = "";
  let location = "";
  let emdRaw: unknown = "";
  let reason = "";
  let category = "";
  let org: string | null = null;
  let msme: boolean | null = null;
  let startup: boolean | null = null;
  let rowDate: string | null = null;
  let status: Phase1ScreeningStatus | null = null;

  if (map) {
    t247 = digitsT247(pick(map, cells, T247_ALIASES));
    portalRaw = pick(map, cells, PORTAL_ALIASES);
    ref = cleanText(pick(map, cells, REF_ALIASES));
    brief = cleanText(pick(map, cells, BRIEF_ALIASES));
    valueRaw = pick(map, cells, VALUE_ALIASES);
    // Prefer headers that are exactly tender value / estimated value
    const valueAlt = pick(map, cells, ["tender value ", "tender value ( )"]);
    if (!valueRaw && valueAlt) valueRaw = valueAlt;
    // 11 aug uses "Tender Value (₹)"
    for (const [k, idx] of map) {
      if (/tender value/.test(k) && cells[idx] != null && String(cells[idx]).trim()) {
        valueRaw = cells[idx];
        break;
      }
      if (/^emd/.test(k) && !/check/.test(k) && cells[idx] != null) {
        emdRaw = cells[idx];
      }
    }
    deadlineRaw = pick(map, cells, DEADLINE_ALIASES);
    location = cleanText(pick(map, cells, LOCATION_ALIASES));
    if (!emdRaw) emdRaw = pick(map, cells, EMD_ALIASES);
    reason = cleanText(pick(map, cells, REASON_ALIASES));
    category = cleanText(pick(map, cells, CATEGORY_ALIASES));
    org = cleanText(pick(map, cells, ORG_ALIASES)) || null;
    msme = parseExemptionFlag(pick(map, cells, MSME_ALIASES));
    startup = parseExemptionFlag(pick(map, cells, STARTUP_ALIASES));
    rowDate = toIsoDateOnly(pick(map, cells, ROW_DATE_ALIASES));
    status = resolveStatus(cells, map);
    // 4 aug quirk: Status numeric, NO_BID in Screening Category
    if (!status) {
      status = normalizeHistoricalStatus(pick(map, cells, ["screening category"]));
    }
  } else if (layout === "headerless_date_portal_t247") {
    // 12 aug: date, portal, t247, ref, brief, org, location, deadline, ?, value, emd, cat, status, reason
    rowDate = toIsoDateOnly(cells[0]);
    portalRaw = cells[1];
    t247 = digitsT247(cells[2]);
    ref = cleanText(cells[3]);
    brief = cleanText(cells[4]);
    org = cleanText(cells[5]) || null;
    location = cleanText(cells[6]);
    deadlineRaw = cells[7];
    valueRaw = cells[9];
    emdRaw = cells[10];
    category = cleanText(cells[11]);
    status = normalizeHistoricalStatus(cells[12]);
    reason = cleanText(cells[13]);
  } else if (layout === "headerless_date_t247") {
    // 8 9 10: date, portal, t247, ref, brief, value, deadline, location, emd, cat, status, reason
    rowDate = toIsoDateOnly(cells[0]);
    portalRaw = cells[1];
    t247 = digitsT247(cells[2]);
    ref = cleanText(cells[3]);
    brief = cleanText(cells[4]);
    valueRaw = cells[5];
    deadlineRaw = cells[6];
    location = cleanText(cells[7]);
    emdRaw = cells[8];
    category = cleanText(cells[9]);
    status = normalizeHistoricalStatus(cells[10]);
    reason = cleanText(cells[11]);
  } else {
    // headerless_t247: t247, portal, ref, brief, value, deadline, location, emd, msme, startup, status, reason
    // Sometimes BidAssist puts ref in col0
    const c0 = cleanText(cells[0]);
    const c0Digits = digitsT247(c0);
    if (/^\d{6,}$/.test(c0Digits)) {
      t247 = c0Digits;
      portalRaw = cells[1];
      ref = cleanText(cells[2]);
      brief = cleanText(cells[3]);
      valueRaw = cells[4];
      deadlineRaw = cells[5];
      location = cleanText(cells[6]);
      emdRaw = cells[7];
      msme = parseExemptionFlag(cells[8]);
      startup = parseExemptionFlag(cells[9]);
      status = normalizeHistoricalStatus(cells[10]);
      reason = cleanText(cells[11]);
    } else {
      // BidAssist-ish: ref/portal first
      portalRaw = cells[1];
      ref = c0 || cleanText(cells[2]);
      t247 = digitsT247(cells[2]) || digitsT247(cells[0]);
      brief = cleanText(cells[3]);
      valueRaw = cells[4];
      deadlineRaw = cells[5];
      location = cleanText(cells[6]);
      emdRaw = cells[7];
      status = normalizeHistoricalStatus(cells[10]) || normalizeHistoricalStatus(cells[9]);
      reason = cleanText(cells[11]) || cleanText(cells[10]);
    }
  }

  if (!status) {
    return { invalid: "missing/invalid status" };
  }
  if (!t247 && !brief && !ref) {
    return { invalid: "blank row" };
  }
  if (!t247 && !ref) {
    return { invalid: "no tender id or reference" };
  }

  const sourcePortal = portalFromCell(portalRaw);
  const sourceTenderId =
    t247 ||
    (ref
      ? ref.toUpperCase().startsWith("BA-")
        ? ref
        : ref
      : `NAME-${brief.slice(0, 40)}`);

  // Reject rows where a long reason sentence was mis-read as an ID.
  if (sourceTenderId.length > 80 || /\s{2,}|the core work|outside the/i.test(sourceTenderId)) {
    return { invalid: "unusable tender id" };
  }

  const value = normalizeCurrencyAmount(valueRaw);
  const emd = normalizeCurrencyAmount(emdRaw);
  // 4 aug: EMD cell sometimes holds organization text
  if (emd.amount == null && emd.text && /[a-zA-Z]{3,}/.test(emd.text) && !/₹|rs\.?/i.test(emd.text)) {
    if (!org) org = emd.text;
    emd.text = null;
  }

  const scrapedDate = resolveScrapedDate(rowDate, sheetDates);
  if (!scrapedDate) {
    return { invalid: "unable to resolve scraped_date" };
  }
  // Historical backfill window: 04–20 Aug 2026 only.
  if (scrapedDate < "2026-08-04" || scrapedDate > "2026-08-20") {
    return { invalid: `scraped_date out of historical window (${scrapedDate})` };
  }

  return {
    sourcePortal,
    sourceTenderId,
    folderId: t247 || ref || null,
    title: brief || sourceTenderId,
    organization: org,
    locationText: location || null,
    closingDate: toIsoDateOnly(deadlineRaw),
    tenderValue: value.amount,
    tenderValueText: value.text,
    emdAmount: emd.amount,
    emdText: emd.text,
    qualificationStatus: status,
    screeningReason: reason,
    tenderCategory: category || null,
    msmeExemption: msme,
    startupExemption: startup,
    scrapedDate,
    excelSheetName: sheetName,
    sheetDates,
    rowIndex,
  };
}

/**
 * Resolve scraped_date from optional per-row date + sheet tab dates.
 * - Single-date sheet → trust the tab name (Excel row dates are often wrong / shifted).
 * - Multi-date sheet → use row date only when it is one of the sheet dates; else earliest.
 */
export function resolveScrapedDate(
  rowDate: string | null,
  sheetDates: string[],
): string | null {
  if (sheetDates.length === 1) return sheetDates[0]!;
  if (sheetDates.length > 1) {
    if (rowDate && sheetDates.includes(rowDate)) return rowDate;
    return sheetDates[0]!;
  }
  return rowDate;
}

function detectHeaderlessLayout(
  row0: unknown[],
): "headerless_t247" | "headerless_date_t247" | "headerless_date_portal_t247" {
  const c0 = row0[0];
  const c2 = row0[2];
  const date0 = toIsoDateOnly(c0);
  const t247at2 = /^\d{6,}$/.test(digitsT247(c2));
  const t247at0 = /^\d{6,}$/.test(digitsT247(c0));
  if (date0 && t247at2) {
    // Distinguish 12-aug (org before location) vs 8-9-10 (value before deadline)
    // 12 aug: col5 looks like organization (letters), col9 currency
    const c5 = cleanText(row0[5]);
    const c9 = cleanText(row0[9]);
    if (/[a-zA-Z]{4,}/.test(c5) && (/₹/.test(c9) || /^\d/.test(c9) || c9 === "0")) {
      return "headerless_date_portal_t247";
    }
    return "headerless_date_t247";
  }
  if (t247at0 || date0) {
    return date0 && !t247at0 ? "headerless_date_t247" : "headerless_t247";
  }
  return "headerless_t247";
}

export function parseHistoricalSheet(
  sheetName: string,
  matrix: unknown[][],
): SheetParseResult {
  const sheetDates = parseDatesFromSheetName(sheetName);
  if (shouldSkipSheet(sheetName)) {
    return {
      sheetName,
      skipped: true,
      skipReason: "protected or ignored sheet",
      sheetDates,
      rowsRead: 0,
      validRows: [],
      invalidRows: [],
    };
  }
  if (matrix.length === 0) {
    return {
      sheetName,
      skipped: true,
      skipReason: "empty sheet",
      sheetDates,
      rowsRead: 0,
      validRows: [],
      invalidRows: [],
    };
  }

  const row0 = matrix[0] ?? [];
  const headered = looksLikeHeaderRow(row0);
  const map = headered
    ? headerMap((row0 as unknown[]).map((h) => String(h ?? "")))
    : null;
  const layout = headered
    ? ("headered" as const)
    : detectHeaderlessLayout(row0);
  const dataRows = headered ? matrix.slice(1) : matrix;

  const validRows: HistoricalTenderRow[] = [];
  const invalidRows: Array<{ rowIndex: number; reason: string }> = [];

  dataRows.forEach((raw, i) => {
    if (!Array.isArray(raw)) return;
    const rowIndex = headered ? i + 2 : i + 1;
    const built = buildRow({
      cells: raw,
      map,
      sheetName,
      sheetDates,
      rowIndex,
      layout: headered ? "headered" : layout,
    });
    if ("invalid" in built) {
      // skip totally empty
      if (built.invalid === "blank row") return;
      invalidRows.push({ rowIndex, reason: built.invalid });
      return;
    }
    validRows.push(built);
  });

  return {
    sheetName,
    skipped: false,
    skipReason: null,
    sheetDates,
    rowsRead: dataRows.length,
    validRows,
    invalidRows,
  };
}

export function readHistoricalWorkbook(filePath: string): {
  sheetNames: string[];
  sheets: SheetParseResult[];
} {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Workbook not found: ${filePath}`);
  }
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheets: SheetParseResult[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    });
    sheets.push(parseHistoricalSheet(sheetName, matrix));
  }
  return { sheetNames: [...workbook.SheetNames], sheets };
}
