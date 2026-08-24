/**
 * Deterministic run workbook: column normalize + exact-id dedupe only.
 * No company-preference classification before GPT.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { ensureDir } from "../fileUtils.js";
import {
  buildHeaderMap,
  cleanCell,
  formatIdAsText,
  getField,
  hasAnyHeaders,
  normalizeHeaderKey,
} from "../excel/types.js";
import {
  coercePhase1WorkbookStatus,
  isDetailScrapeStatus,
  toPhase1WorkbookStatusLabel,
  type Phase1ScreeningStatus,
} from "./phase1Statuses.js";

export const RUN_SCREENED_FILE = "run-screened-siyana.xlsx";

/** @deprecated Phase-1 no longer writes/requires this before GPT. */
export const RUN_NORMALIZED_FILE = "run-normalized.xlsx";

export function expectedScreenedOutputFilename(
  inputFileName: string,
  correlationId: string,
): string {
  const stem = path.basename(inputFileName).replace(/\.xlsx$/i, "") || "tender247";
  return `${stem}-screened-${correlationId}.xlsx`;
}

export type RunSourcePortal = "TENDER247" | "BIDASSIST" | "BOTH";

export type Phase1RowClassification = {
  tenderType: string;
  primaryScope: string;
  procurementModel: string;
  dominantScope: string;
  preferredScopeMatch: string;
  hardGateFailed: boolean;
  classificationConfidence: string;
  /** Column label → true when cell is YES */
  flags: Record<string, boolean>;
};

export type RunWorkbookRow = {
  canonicalId: string;
  source: RunSourcePortal;
  tender247Id: string;
  bidAssistId: string;
  tenderName: string;
  organization: string;
  location: string;
  deadline: string;
  estimatedCost: string;
  emdAmount: string;
  sourceRefs: string;
  screeningStatus: Phase1ScreeningStatus | "";
  screeningReason: string;
  /** Free-text tender category from uploaded / portal Excel. */
  tenderCategory?: string;
  /** MSME exemption flag when present on the source sheet. */
  msmeExemption?: boolean | null;
  /** Startup India exemption flag when present on the source sheet. */
  startupExemption?: boolean | null;
  /** Optional GPT classification columns used only for local status repair. */
  classification?: Phase1RowClassification;
};

export type NormalizedRunWorkbook = {
  rows: RunWorkbookRow[];
  tender247Raw: number;
  bidAssistRaw: number;
  tender247Unique: number;
  bidAssistUnique: number;
  combinedUnique: number;
  duplicatesRemoved: number;
};

const T247_ID_HEADERS = [
  "T247 ID",
  "T247 ID2",
  "Tender247 ID",
  "Tender 247 ID",
  "Tender Id",
  "Tender ID",
  "Canonical ID",
];
const BA_ID_HEADERS = [
  "BidAssist ID",
  "GEM/Eprocure ID",
  "REFERENCE NO",
  "Reference No",
  "Reference No.",
];
const TITLE_HEADERS = [
  "TENDER BRIEF",
  "Tender Brief",
  "Tender Name",
  "Summary",
  "Title",
  "Description",
];
const ORG_HEADERS = ["Organization", "Organisation", "Department", "Authority"];
const LOCATION_HEADERS = ["Location", "State", "City"];
const VALUE_HEADERS = [
  "ESTIMATED COST",
  "Estimated Cost",
  "Estimated Value",
  "Tender Est. Cost",
  "Tender Amount",
  "Value",
];
const EMD_HEADERS = ["EMD", "EMD Amount"];
const DEADLINE_HEADERS = ["Deadline", "Last Date", "Closing Date"];
const SOURCE_HEADERS = ["Source", "Portal"];
const STATUS_HEADERS = ["Screening Status", "Status"];
const REASON_HEADERS = [
  "Screening Reason",
  "Decision Reason",
  "Reason",
];
const CATEGORY_HEADERS = [
  "Tender Category",
  "Category",
  "Project Category",
];
const MSME_HEADERS = ["MSME Exemption", "MSME"];
const STARTUP_HEADERS = ["Startup Exemption", "Startup India Exemption", "Startup"];

const CLASSIFICATION_FLAG_HEADERS = [
  "EOI",
  "Empanelment",
  "Scanning / Digitization",
  "Data Entry",
  "Dedicated Manpower",
  "Resource Augmentation",
  "COTS / Product / Licence",
  "Product-specific AMC",
  "API / SaaS Subscription",
  "Hardware Dominant",
  "Network / Connectivity",
  "GIS Field Survey",
  "Cybersecurity Only",
  "Industrial Automation / SCADA",
  "OEM Dependency",
  "Partner / JV Dependency",
  "Non-IT Dominant",
  "Hard Gate Failed",
] as const;

function isYesCell(raw: unknown): boolean {
  return /^(yes|y|true|1)$/i.test(String(raw ?? "").trim());
}

/** Parse Yes/No exemption cells; blank → null. */
export function parseExemptionFlag(raw: unknown): boolean | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (/^(yes|y|true|1|applicable|available)$/i.test(text)) return true;
  if (/^(no|n|false|0|na|n\/a|not\s*applicable|-)$/i.test(text)) return false;
  return null;
}

function readPhase1Classification(
  record: Record<string, unknown>,
  headerMap: Map<string, string>,
): Phase1RowClassification | undefined {
  const tenderType = cleanCell(getField(record, headerMap, "Tender Type"));
  const primaryScope = cleanCell(getField(record, headerMap, "Primary Scope"));
  const procurementModel = cleanCell(
    getField(record, headerMap, "Procurement Model"),
  );
  const dominantScope = cleanCell(getField(record, headerMap, "Dominant Scope"));
  const preferredScopeMatch = cleanCell(
    getField(record, headerMap, "Preferred Scope Match"),
  );
  const classificationConfidence = cleanCell(
    getField(record, headerMap, "Classification Confidence"),
  );
  const flags: Record<string, boolean> = {};
  let anyFlag = false;
  for (const label of CLASSIFICATION_FLAG_HEADERS) {
    const value = getField(record, headerMap, label);
    if (value == null || String(value).trim() === "") continue;
    anyFlag = true;
    flags[label] = isYesCell(value);
  }
  if (
    !tenderType &&
    !primaryScope &&
    !procurementModel &&
    !dominantScope &&
    !preferredScopeMatch &&
    !anyFlag
  ) {
    return undefined;
  }
  return {
    tenderType,
    primaryScope,
    procurementModel,
    dominantScope,
    preferredScopeMatch,
    hardGateFailed: Boolean(flags["Hard Gate Failed"]),
    classificationConfidence,
    flags,
  };
}

const OUTPUT_HEADERS = [
  "Canonical ID",
  "Tender247 ID",
  "BidAssist ID",
  "Tender Name",
  "Source",
  "Organization",
  "Location",
  "Deadline",
  "Estimated Cost",
  "EMD Amount",
  "Source Refs",
  "Screening Status",
  "Screening Reason",
];

export class ScreeningOutputInvalidError extends Error {
  readonly code:
    | "SCREENING_OUTPUT_INVALID"
    | "SCREENING_OUTPUT_RECONCILIATION_FAILED"
    | "SCREENING_OUTPUT_MISSING";
  constructor(
    message: string,
    code:
      | "SCREENING_OUTPUT_INVALID"
      | "SCREENING_OUTPUT_RECONCILIATION_FAILED"
      | "SCREENING_OUTPUT_MISSING" = "SCREENING_OUTPUT_INVALID",
  ) {
    super(message);
    this.name = "ScreeningOutputInvalidError";
    this.code = code;
  }
}

function sheetLooksLikeTenders(headerMap: Map<string, string>): boolean {
  return (
    hasAnyHeaders(headerMap, [...T247_ID_HEADERS, ...TITLE_HEADERS, "EMD", "Deadline"], 2) ||
    headerMap.has(normalizeHeaderKey("T247 ID")) ||
    headerMap.has(normalizeHeaderKey("T247 ID2")) ||
    headerMap.has(normalizeHeaderKey("Canonical ID")) ||
    headerMap.has(normalizeHeaderKey("Tender Name")) ||
    headerMap.has(normalizeHeaderKey("Tender Brief"))
  );
}

/** ChatGPT helper sheets often repeat Canonical ID + Status — never concatenate them. */
function isHelperScreeningSheetName(sheetName: string): boolean {
  return /^(summary|classification|screening\s*audit|rfp\s*classification|duplicates?\s*removed|audit)$/i.test(
    sheetName.trim(),
  );
}

function scoreTenderSheet(sheetName: string, headerMap: Map<string, string>): number {
  let score = 0;
  // Prefer a single GPT analysis sheet — do NOT treat "GeM Tenders" / "Non-GeM Tenders"
  // as sole winners (those must be flatMapped together).
  if (/current\s*analysis|today'?s?\s*analysis|\bmain\b|^tenders?$/i.test(sheetName.trim())) {
    score += 50;
  }
  if (/gem|non-?\s*gem/i.test(sheetName)) score += 10;
  if (isHelperScreeningSheetName(sheetName)) score -= 100;
  if (headerMap.has(normalizeHeaderKey("Tender Name"))) score += 20;
  if (headerMap.has(normalizeHeaderKey("Tender Brief"))) score += 20;
  if (headerMap.has(normalizeHeaderKey("Tender247 ID"))) score += 15;
  if (headerMap.has(normalizeHeaderKey("T247 ID2"))) score += 15;
  if (headerMap.has(normalizeHeaderKey("Screening Status"))) score += 15;
  if (headerMap.has(normalizeHeaderKey("Organization"))) score += 10;
  if (headerMap.has(normalizeHeaderKey("Estimated Cost"))) score += 5;
  if (headerMap.has(normalizeHeaderKey("Estimated Value"))) score += 5;
  if (headerMap.has(normalizeHeaderKey("EMD Amount"))) score += 5;
  if (headerMap.has(normalizeHeaderKey("EMD"))) score += 5;
  // Classification-only helper: Status/Reason without tender body columns.
  if (
    headerMap.has(normalizeHeaderKey("Status")) &&
    !headerMap.has(normalizeHeaderKey("Tender Name")) &&
    !headerMap.has(normalizeHeaderKey("Screening Status"))
  ) {
    score -= 40;
  }
  return score;
}

function digitsT247(raw: string): string {
  const id = raw.replace(/^T247[-\s]*/i, "");
  const digits = id.replace(/\D/g, "");
  return digits || id.trim();
}

/**
 * Uploaded Final_Aug-style sheets often have NO header row —
 * first cell is a numeric T247 id, not a column title.
 */
function matrixLooksHeaderlessPrescreened(matrix: unknown[][]): boolean {
  if (matrix.length < 1) return false;
  const row0 = (matrix[0] ?? []).map((c) => String(c ?? "").trim());
  const firstRaw = row0[0] || "";
  if (/t247\s*id|tender\s*brief|estimated\s*value|deadline|status/i.test(firstRaw)) {
    return false;
  }
  return /^\d{6,}$/.test(digitsT247(firstRaw));
}

function excelSerialToIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const serial = Number(text);
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) {
    return text;
  }
  // Excel serial date (1900 date system).
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  return new Date(utc).toISOString().slice(0, 10);
}

function parseHeaderlessPrescreenedRows(
  matrix: unknown[][],
  defaultSource: RunSourcePortal,
): RunWorkbookRow[] {
  const rows: RunWorkbookRow[] = [];
  for (const raw of matrix) {
    if (!Array.isArray(raw)) continue;
    const cells = raw.map((c) => c);
    const t247 = digitsT247(formatIdAsText(cells[0]));
    const portal = cleanCell(cells[1]);
    const referenceNo = formatIdAsText(cells[2]);
    const brief = cleanCell(cells[3]);
    if (!t247 && !brief) continue;
    const statusRaw = cleanCell(cells[10]);
    const status = coercePhase1WorkbookStatus(statusRaw) ?? "";
    if (!t247 && !status) continue;
    const source: RunSourcePortal =
      /bidassist/i.test(portal)
        ? "BIDASSIST"
        : /tender247/i.test(portal)
          ? "TENDER247"
          : defaultSource;
    rows.push({
      canonicalId: t247 ? `T247-${t247}` : `NAME-${brief.slice(0, 40)}`,
      source,
      tender247Id: t247,
      bidAssistId: referenceNo,
      tenderName: brief,
      organization: "",
      location: cleanCell(cells[6]),
      deadline: excelSerialToIso(cells[5]),
      estimatedCost: cleanCell(cells[4]),
      emdAmount: cleanCell(cells[7]),
      sourceRefs: portal || source,
      screeningStatus: status,
      screeningReason: cleanCell(cells[11]),
      msmeExemption: parseExemptionFlag(cells[8]),
      startupExemption: parseExemptionFlag(cells[9]),
    });
  }
  return rows;
}

function parseSheetRows(
  matrix: unknown[][],
  defaultSource: RunSourcePortal,
): RunWorkbookRow[] {
  if (matrix.length < 1) return [];

  if (matrixLooksHeaderlessPrescreened(matrix)) {
    return parseHeaderlessPrescreenedRows(matrix, defaultSource);
  }

  if (matrix.length < 2) return [];
  const headers = (matrix[0] ?? []).map((h) => String(h ?? "").trim());
  const headerMap = buildHeaderMap(headers);
  if (!sheetLooksLikeTenders(headerMap)) return [];
  const rows: RunWorkbookRow[] = [];
  for (const raw of matrix.slice(1) as Array<Record<string, unknown> | unknown[]>) {
    const record: Record<string, unknown> = Array.isArray(raw)
      ? Object.fromEntries(headers.map((h, i) => [h, raw[i]]))
      : raw;
    const t247 = digitsT247(formatIdAsText(getField(record, headerMap, ...T247_ID_HEADERS)));
    const ba = formatIdAsText(getField(record, headerMap, ...BA_ID_HEADERS));
    const name = cleanCell(getField(record, headerMap, ...TITLE_HEADERS));
    if (!t247 && !ba && !name) continue;
    const sourceCell = cleanCell(getField(record, headerMap, ...SOURCE_HEADERS));
    const source: RunSourcePortal =
      /both/i.test(sourceCell)
        ? "BOTH"
        : /bidassist/i.test(sourceCell)
          ? "BIDASSIST"
          : /tender247/i.test(sourceCell)
            ? "TENDER247"
            : defaultSource;
    const canonicalId = t247
      ? `T247-${t247}`
      : ba
        ? ba.toUpperCase().startsWith("BA-")
          ? ba
          : `BA-${ba}`
        : `NAME-${name.slice(0, 40)}`;
    const statusRaw = cleanCell(getField(record, headerMap, ...STATUS_HEADERS));
    const deadlineRaw = getField(record, headerMap, ...DEADLINE_HEADERS);
    const tenderCategory = cleanCell(
      getField(record, headerMap, ...CATEGORY_HEADERS),
    );
    rows.push({
      canonicalId,
      source,
      tender247Id: t247,
      bidAssistId: ba,
      tenderName: name,
      organization: cleanCell(getField(record, headerMap, ...ORG_HEADERS)),
      location: cleanCell(getField(record, headerMap, ...LOCATION_HEADERS)),
      deadline: excelSerialToIso(deadlineRaw) || cleanCell(deadlineRaw),
      estimatedCost: cleanCell(getField(record, headerMap, ...VALUE_HEADERS)),
      emdAmount: cleanCell(getField(record, headerMap, ...EMD_HEADERS)),
      sourceRefs: sourceCell || source,
      screeningStatus: coercePhase1WorkbookStatus(statusRaw) ?? "",
      screeningReason: cleanCell(getField(record, headerMap, ...REASON_HEADERS)),
      tenderCategory: tenderCategory || undefined,
      msmeExemption: parseExemptionFlag(
        getField(record, headerMap, ...MSME_HEADERS),
      ),
      startupExemption: parseExemptionFlag(
        getField(record, headerMap, ...STARTUP_HEADERS),
      ),
      classification: readPhase1Classification(record, headerMap),
    });
  }
  return rows;
}

function parseWorkbookRows(
  filePath: string,
  defaultSource: RunSourcePortal,
): RunWorkbookRow[] {
  if (!fs.existsSync(filePath)) return [];
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  type Candidate = {
    sheetName: string;
    score: number;
    rows: RunWorkbookRow[];
  };
  const candidates: Candidate[] = [];
  for (const sheetName of workbook.SheetNames) {
    if (isHelperScreeningSheetName(sheetName)) continue;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    });
    if (matrix.length < 1) continue;

    // Headerless Final_Aug-style: first row is data (T247 id), not titles.
    if (matrixLooksHeaderlessPrescreened(matrix)) {
      const rows = parseHeaderlessPrescreenedRows(matrix, defaultSource);
      if (!rows.length) continue;
      candidates.push({
        sheetName,
        score: 80 + Math.min(rows.length, 50),
        rows,
      });
      continue;
    }

    if (matrix.length < 2) continue;
    const headers = (matrix[0] ?? []).map((h) => String(h ?? "").trim());
    const headerMap = buildHeaderMap(headers);
    if (!sheetLooksLikeTenders(headerMap)) continue;
    const rows = parseSheetRows(matrix, defaultSource);
    if (!rows.length) continue;
    candidates.push({
      sheetName,
      score: scoreTenderSheet(sheetName, headerMap),
      rows,
    });
  }
  if (!candidates.length) return [];
  // Prefer a single main analysis sheet so Classification-style helpers never double-count.
  candidates.sort((a, b) => b.score - a.score || b.rows.length - a.rows.length);
  const best = candidates[0]!;
  const portalMultiSheet =
    candidates.length > 1 &&
    candidates.every((c) => /gem|non-?\s*gem|tender/i.test(c.sheetName)) &&
    !candidates.some((c) => /current\s*analysis/i.test(c.sheetName));
  if (portalMultiSheet || candidates.every((c) => c.score < 30)) {
    return candidates.flatMap((c) => c.rows);
  }
  if (candidates.length > 1 && best.score >= 30) {
    return best.rows;
  }
  return best.rows;
}

function mergeRows(left: RunWorkbookRow, right: RunWorkbookRow): RunWorkbookRow {
  const t247 = left.tender247Id || right.tender247Id;
  const ba = left.bidAssistId || right.bidAssistId;
  const bothSources =
    (left.source === "TENDER247" && right.source === "BIDASSIST") ||
    (left.source === "BIDASSIST" && right.source === "TENDER247") ||
    left.source === "BOTH" ||
    right.source === "BOTH";
  return {
    canonicalId: t247 ? `T247-${t247}` : left.canonicalId,
    source: bothSources ? "BOTH" : left.source,
    tender247Id: t247,
    bidAssistId: ba,
    tenderName: left.tenderName || right.tenderName,
    organization: left.organization || right.organization,
    location: left.location || right.location,
    deadline: left.deadline || right.deadline,
    estimatedCost: left.estimatedCost || right.estimatedCost,
    emdAmount: left.emdAmount || right.emdAmount,
    sourceRefs: [left.sourceRefs, right.sourceRefs].filter(Boolean).join("; "),
    screeningStatus: left.screeningStatus || right.screeningStatus,
    screeningReason: left.screeningReason || right.screeningReason,
    tenderCategory: left.tenderCategory || right.tenderCategory,
    msmeExemption:
      left.msmeExemption != null ? left.msmeExemption : right.msmeExemption,
    startupExemption:
      left.startupExemption != null
        ? left.startupExemption
        : right.startupExemption,
  };
}

/** True when enough rows already carry a screening Status (uploaded shortlist). */
export function workbookLooksPreScreened(rows: RunWorkbookRow[]): boolean {
  if (rows.length === 0) return false;
  const withStatus = rows.filter((row) => Boolean(row.screeningStatus)).length;
  return withStatus >= Math.max(1, Math.ceil(rows.length * 0.5));
}

function dedupeKey(row: RunWorkbookRow): string {
  if (row.tender247Id) return `T247:${row.tender247Id}`;
  if (row.bidAssistId) return `BA:${row.bidAssistId.toLowerCase()}`;
  return `NAME:${row.tenderName.toLowerCase()}`;
}

export function normalizeAndDedupeRunRows(options: {
  tender247Rows: RunWorkbookRow[];
  bidAssistRows: RunWorkbookRow[];
}): NormalizedRunWorkbook {
  const tender247Raw = options.tender247Rows.length;
  const bidAssistRaw = options.bidAssistRows.length;
  const t247Map = new Map<string, RunWorkbookRow>();
  for (const row of options.tender247Rows) {
    const key = dedupeKey(row);
    if (!t247Map.has(key)) t247Map.set(key, row);
  }
  const baMap = new Map<string, RunWorkbookRow>();
  for (const row of options.bidAssistRows) {
    const key = dedupeKey(row);
    if (!baMap.has(key)) baMap.set(key, row);
  }

  const combined = new Map<string, RunWorkbookRow>();
  for (const row of t247Map.values()) combined.set(dedupeKey(row), { ...row });
  for (const row of baMap.values()) {
    const key = dedupeKey(row);
    const existing = combined.get(key);
    combined.set(key, existing ? mergeRows(existing, row) : { ...row });
  }

  const rows = [...combined.values()];
  const duplicatesRemoved = tender247Raw + bidAssistRaw - rows.length;
  return {
    rows,
    tender247Raw,
    bidAssistRaw,
    tender247Unique: t247Map.size,
    bidAssistUnique: baMap.size,
    combinedUnique: rows.length,
    duplicatesRemoved: Math.max(0, duplicatesRemoved),
  };
}

export function parseSourceWorkbook(
  filePath: string | undefined,
  defaultSource: RunSourcePortal,
): RunWorkbookRow[] {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return parseWorkbookRows(filePath, defaultSource);
}

export function writeRunWorkbook(rows: RunWorkbookRow[], outputPath: string): string {
  ensureDir(path.dirname(outputPath));
  const aoa: unknown[][] = [
    OUTPUT_HEADERS,
    ...rows.map((row) => [
      row.canonicalId,
      row.tender247Id,
      row.bidAssistId,
      row.tenderName,
      row.source,
      row.organization,
      row.location,
      row.deadline,
      row.estimatedCost,
      row.emdAmount,
      row.sourceRefs,
      toPhase1WorkbookStatusLabel(row.screeningStatus),
      row.screeningReason,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Tenders");
  XLSX.writeFile(workbook, outputPath);
  return outputPath;
}

export function readRunWorkbook(filePath: string): RunWorkbookRow[] {
  if (!fs.existsSync(filePath)) {
    throw new ScreeningOutputInvalidError(`Workbook not found: ${filePath}`);
  }
  try {
    return parseWorkbookRows(filePath, "TENDER247");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ScreeningOutputInvalidError(`Invalid XLSX: ${message}`);
  }
}

export function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function hashText(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function countPhase1Statuses(
  rows: RunWorkbookRow[],
): Record<Phase1ScreeningStatus, number> {
  const counts: Record<Phase1ScreeningStatus, number> = {
    GO: 0,
    CONDITIONAL_GO: 0,
    PARTNER_BID: 0,
    VERIFY: 0,
    NO_GO: 0,
  };
  for (const row of rows) {
    if (row.screeningStatus) counts[row.screeningStatus] += 1;
  }
  return counts;
}

export function deriveDetailScrapeIds(rows: RunWorkbookRow[]): {
  tender247Ids: string[];
  bidAssistIds: string[];
} {
  const tender247Ids: string[] = [];
  const bidAssistIds: string[] = [];
  for (const row of rows) {
    if (!isDetailScrapeStatus(row.screeningStatus || null)) continue;
    if (row.tender247Id) tender247Ids.push(row.tender247Id);
    else if (row.bidAssistId) bidAssistIds.push(row.bidAssistId);
  }
  return {
    tender247Ids: [...new Set(tender247Ids)],
    bidAssistIds: [...new Set(bidAssistIds)],
  };
}

export function validateScreenedWorkbook(options: {
  inputRows: RunWorkbookRow[];
  outputPath: string;
  /** When true, empty Screening Status does not throw (caller may repair). */
  allowMissingStatus?: boolean;
}): {
  outputRows: RunWorkbookRow[];
  counts: Record<Phase1ScreeningStatus, number>;
  missingStatusIds: string[];
} {
  const { inputRows, outputPath } = options;
  if (!fs.existsSync(outputPath)) {
    throw new ScreeningOutputInvalidError("Screened workbook file does not exist");
  }
  const st = fs.statSync(outputPath);
  if (!st.isFile() || st.size <= 0) {
    throw new ScreeningOutputInvalidError("Screened workbook is empty");
  }
  const header = fs.readFileSync(outputPath).subarray(0, 4);
  if (header.length < 2 || header[0] !== 0x50 || header[1] !== 0x4b) {
    throw new ScreeningOutputInvalidError(
      "Screened workbook is not a valid XLSX/ZIP container",
    );
  }
  const outputRows = readRunWorkbook(outputPath);
  if (outputRows.length === 0) {
    throw new ScreeningOutputInvalidError("Screened workbook has no data rows");
  }

  const inputIds = new Set(inputRows.map((row) => row.canonicalId));
  const outputIds = new Set(outputRows.map((row) => row.canonicalId));
  const missingIds = [...inputIds].filter((id) => !outputIds.has(id));
  const extra = [...outputIds].filter((id) => !inputIds.has(id));
  if (missingIds.length > 0) {
    throw new ScreeningOutputInvalidError(
      `SCREENING_OUTPUT_RECONCILIATION_FAILED missing ${missingIds.length} tenders (e.g. ${missingIds.slice(0, 5).join(", ")})`,
      "SCREENING_OUTPUT_RECONCILIATION_FAILED",
    );
  }
  if (extra.length > 0) {
    throw new ScreeningOutputInvalidError(
      `SCREENING_OUTPUT_RECONCILIATION_FAILED unexpected extra ${extra.length} tenders (e.g. ${extra.slice(0, 5).join(", ")})`,
      "SCREENING_OUTPUT_RECONCILIATION_FAILED",
    );
  }
  if (outputRows.length !== inputRows.length) {
    throw new ScreeningOutputInvalidError(
      `SCREENING_OUTPUT_RECONCILIATION_FAILED row count mismatch input=${inputRows.length} output=${outputRows.length}`,
      "SCREENING_OUTPUT_RECONCILIATION_FAILED",
    );
  }

  const seen = new Set<string>();
  const missingStatusIds: string[] = [];
  for (const row of outputRows) {
    // Exact duplicate IDs can exist in the original Tender247 export; keep them.
    seen.add(row.canonicalId);
    if (!row.screeningStatus) {
      missingStatusIds.push(row.canonicalId);
    }
  }

  if (missingStatusIds.length > 0 && !options.allowMissingStatus) {
    throw new ScreeningOutputInvalidError(
      `SCREENING_OUTPUT_INVALID missing status for ${missingStatusIds[0]}`,
    );
  }

  return {
    outputRows,
    counts: countPhase1Statuses(outputRows),
    missingStatusIds,
  };
}
