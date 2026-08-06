/** Shared Excel conversion types for tender-app import workbook. */

export const IMPORT_HEADERS = [
  "Tender247 ID",
  "GEM/Eprocure ID",
  "Tender Name",
  "Portal Link",
  "Source",
  "Tender Type",
  "Last Date",
  "Location",
  "Expected Start Date",
  "Expected End Date",
  "Expected Days",
  "MSME Exempted",
  "Startup Exempted",
  "Tender Est. Cost",
  "Tender Fees",
  "EMD Amount",
  "Status",
  "Assigned To",
  "Tender Notes",
  "PQ Criteria",
] as const;

export type ImportHeader = (typeof IMPORT_HEADERS)[number];

export interface TenderImportRow {
  tender247Id: string;
  gemEprocureId: string;
  tenderName: string;
  portalLink: string;
  source: string;
  tenderType: string;
  lastDate: string;
  location: string;
  expectedStartDate: string;
  expectedEndDate: string;
  expectedDays: string | number;
  msmeExempted: string;
  startupExempted: string;
  tenderEstimatedCost: number | "";
  tenderFees: number | "";
  emdAmount: number | "";
  status: string;
  assignedTo: string;
  tenderNotes: string;
  pqCriteria: string;
}

export interface MappingStats {
  sourceLabel: string;
  sourceFile?: string;
  rowsRead: number;
  rowsMapped: number;
  rowsSkipped: number;
  warnings: string[];
}

export interface ConversionResult {
  outputPath: string;
  outputSizeBytes: number;
  totalMapped: number;
  totalSkipped: number;
  stats: MappingStats[];
}

export class ExcelConversionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExcelConversionError";
    this.code = code;
  }
}

export type ConvertSourceMode = "tender247" | "bidassist" | "all";

export function emptyTenderImportRow(
  overrides: Partial<TenderImportRow> = {},
): TenderImportRow {
  return {
    tender247Id: "",
    gemEprocureId: "",
    tenderName: "",
    portalLink: "",
    source: "",
    tenderType: "",
    lastDate: "",
    location: "",
    expectedStartDate: "",
    expectedEndDate: "",
    expectedDays: "",
    msmeExempted: "",
    startupExempted: "",
    tenderEstimatedCost: "",
    tenderFees: "",
    emdAmount: "",
    status: "new",
    assignedTo: "",
    tenderNotes: "",
    pqCriteria: "",
    ...overrides,
  };
}

/** Convert a mapped row to the exact 20-column array order. */
export function tenderImportRowToArray(row: TenderImportRow): unknown[] {
  return [
    row.tender247Id,
    row.gemEprocureId,
    row.tenderName,
    row.portalLink,
    row.source,
    row.tenderType,
    row.lastDate,
    row.location,
    row.expectedStartDate,
    row.expectedEndDate,
    row.expectedDays,
    row.msmeExempted,
    row.startupExempted,
    row.tenderEstimatedCost,
    row.tenderFees,
    row.emdAmount,
    row.status,
    row.assignedTo,
    truncateExcelText(row.tenderNotes),
    truncateExcelText(row.pqCriteria),
  ];
}

/** Excel cell text limit is 32767 characters. */
const EXCEL_MAX_CELL_CHARS = 32767;

export function truncateExcelText(value: string): string {
  if (value.length <= EXCEL_MAX_CELL_CHARS) {
    return value;
  }
  const marker = "\n…[truncated]";
  return value.slice(0, EXCEL_MAX_CELL_CHARS - marker.length) + marker;
}

export function cleanCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "";
    }
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  let text = String(value).trim();
  if (
    text === "" ||
    text === "-" ||
    text.toLowerCase() === "undefined" ||
    text.toLowerCase() === "null" ||
    text.toLowerCase() === "n/a" ||
    text.toLowerCase() === "na"
  ) {
    return "";
  }
  return text;
}

export function normalizeHeaderKey(header: string): string {
  return header
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function getField(
  row: Record<string, unknown>,
  headerMap: Map<string, string>,
  ...candidates: string[]
): unknown {
  for (const candidate of candidates) {
    const key = headerMap.get(normalizeHeaderKey(candidate));
    if (key !== undefined && Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }
  // Direct fallback for exact keys
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) {
      return row[candidate];
    }
  }
  return undefined;
}

export function buildHeaderMap(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of headers) {
    map.set(normalizeHeaderKey(header), header);
  }
  return map;
}

export function hasAllHeaders(
  headerMap: Map<string, string>,
  required: string[],
): boolean {
  return required.every((name) => headerMap.has(normalizeHeaderKey(name)));
}

export function hasAnyHeaders(
  headerMap: Map<string, string>,
  candidates: string[],
  minMatches: number,
): boolean {
  let count = 0;
  for (const name of candidates) {
    if (headerMap.has(normalizeHeaderKey(name))) {
      count += 1;
    }
  }
  return count >= minMatches;
}

export function formatIdAsText(value: unknown): string {
  const cleaned = cleanCell(value);
  if (!cleaned) {
    return "";
  }
  // Avoid scientific notation / trailing .0 from Excel numerics
  if (/^\d+\.0+$/.test(cleaned)) {
    return cleaned.replace(/\.0+$/, "");
  }
  if (/^\d+\.\d+e\+\d+$/i.test(cleaned)) {
    const num = Number(cleaned);
    if (Number.isFinite(num)) {
      return String(Math.trunc(num));
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return cleaned;
}

export function isValidHttpUrl(value: string): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildNotes(lines: Array<[string, string]>): string {
  return lines
    .filter(([, value]) => value.trim() !== "")
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export function shouldSkipSparseRow(row: TenderImportRow): boolean {
  const hasId = Boolean(row.tender247Id || row.gemEprocureId);
  const hasName = Boolean(row.tenderName);
  const hasDate = Boolean(row.lastDate);
  return !hasId && !hasName && !hasDate;
}
