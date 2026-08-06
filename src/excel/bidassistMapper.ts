import XLSX from "xlsx";
import type { Logger } from "../logger.js";
import { parseAmount, normalizeYesNo } from "./amountParser.js";
import { parseDateToIso } from "./dateParser.js";
import {
  ExcelConversionError,
  buildHeaderMap,
  buildNotes,
  cleanCell,
  emptyTenderImportRow,
  formatIdAsText,
  getField,
  hasAnyHeaders,
  shouldSkipSparseRow,
  type MappingStats,
  type TenderImportRow,
} from "./types.js";

const NON_GEM_MARKERS = [
  "T247 ID",
  "REFERENCE NO",
  "TENDER BRIEF",
  "ESTIMATED COST",
  "Deadline",
];

const GEM_MARKERS = [
  "T247 ID",
  "REFERENCE NO",
  "TENDER BRIEF",
  "Value",
  "Deadline",
];

export interface MapWorkbookResult {
  rows: TenderImportRow[];
  stats: MappingStats;
}

/**
 * Map BidAssist workbook (Non-GeM Tenders + GeM Tenders sheets) into import rows.
 */
export function mapBidAssistWorkbook(
  filePath: string,
  logger: Logger,
): MapWorkbookResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(filePath, { cellDates: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExcelConversionError(
      "INVALID_WORKBOOK",
      `Failed to read BidAssist workbook: ${message}`,
    );
  }

  const rows: TenderImportRow[] = [];
  const warnings: string[] = [];
  let rowsRead = 0;
  let rowsMapped = 0;
  let rowsSkipped = 0;
  let matchedSheets = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    });
    if (matrix.length === 0) {
      continue;
    }

    const headers = (matrix[0] ?? []).map((h) => String(h ?? "").trim());
    const headerMap = buildHeaderMap(headers);
    const objects = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: true,
    });

    const sheetKind = classifyBidAssistSheet(sheetName, headerMap);
    if (!sheetKind) {
      continue;
    }

    matchedSheets += 1;
    logger.info(`BidAssist ${sheetKind} sheet detected: "${sheetName}"`);

    const mapped = mapSheet(objects, headerMap, sheetKind, logger);
    rowsRead += mapped.rowsRead;
    rowsMapped += mapped.rowsMapped;
    rowsSkipped += mapped.rowsSkipped;
    warnings.push(...mapped.warnings);
    rows.push(...mapped.rows);
  }

  if (matchedSheets === 0) {
    throw new ExcelConversionError(
      "BIDASSIST_HEADERS_NOT_FOUND",
      `Could not find Non-GeM / GeM tender sheets in ${filePath}. Sheets: ${workbook.SheetNames.join(", ")}`,
    );
  }

  return {
    rows,
    stats: {
      sourceLabel: "BidAssist",
      sourceFile: filePath,
      rowsRead,
      rowsMapped,
      rowsSkipped,
      warnings,
    },
  };
}

function classifyBidAssistSheet(
  sheetName: string,
  headerMap: Map<string, string>,
): "Non-GeM" | "GeM" | undefined {
  const name = sheetName.toLowerCase();
  if (name.includes("non") && name.includes("gem")) {
    return hasAnyHeaders(headerMap, NON_GEM_MARKERS, 3) ? "Non-GeM" : undefined;
  }
  if (name.includes("gem") && !name.includes("non")) {
    return hasAnyHeaders(headerMap, GEM_MARKERS, 3) ? "GeM" : undefined;
  }

  if (
    hasAnyHeaders(headerMap, NON_GEM_MARKERS, 4) &&
    headerMap.has(normalize("ESTIMATED COST"))
  ) {
    return "Non-GeM";
  }
  if (
    hasAnyHeaders(headerMap, GEM_MARKERS, 4) &&
    (headerMap.has(normalize("Value")) ||
      headerMap.has(normalize("Estimated Bid Value")))
  ) {
    return "GeM";
  }
  return undefined;
}

function normalize(header: string): string {
  return header
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function mapSheet(
  objects: Record<string, unknown>[],
  headerMap: Map<string, string>,
  tenderType: "Non-GeM" | "GeM",
  logger: Logger,
): {
  rows: TenderImportRow[];
  rowsRead: number;
  rowsMapped: number;
  rowsSkipped: number;
  warnings: string[];
} {
  const rows: TenderImportRow[] = [];
  const warnings: string[] = [];
  let rowsRead = 0;
  let rowsMapped = 0;
  let rowsSkipped = 0;

  for (const raw of objects) {
    rowsRead += 1;
    if (Object.values(raw).every((v) => cleanCell(v) === "")) {
      rowsSkipped += 1;
      continue;
    }

    const t247Id = formatIdAsText(getField(raw, headerMap, "T247 ID"));
    const referenceNo = cleanCell(getField(raw, headerMap, "REFERENCE NO"));
    const brief = cleanCell(getField(raw, headerMap, "TENDER BRIEF"));
    const deadlineParsed = parseDateToIso(getField(raw, headerMap, "Deadline"));
    if (deadlineParsed.warning) {
      const msg = `BidAssist ${tenderType} row ${rowsRead}: ${deadlineParsed.warning}`;
      warnings.push(msg);
      logger.warn(msg);
    }

    const location = cleanCell(getField(raw, headerMap, "LOCATION"));
    const organization = cleanCell(getField(raw, headerMap, "Organization"));
    const quantity = cleanCell(getField(raw, headerMap, "Quantity"));
    const checklist = cleanCell(getField(raw, headerMap, "Checklist"));

    let estimatedCost: number | "" = "";
    if (tenderType === "Non-GeM") {
      estimatedCost = parseAmount(getField(raw, headerMap, "ESTIMATED COST"));
    } else {
      estimatedCost = parseAmount(getField(raw, headerMap, "Value"));
      if (estimatedCost === "") {
        estimatedCost = parseAmount(
          getField(raw, headerMap, "Estimated Bid Value"),
        );
      }
    }

    const noteLines: Array<[string, string]> =
      tenderType === "Non-GeM"
        ? [
            ["Organization", organization],
            ["Quantity", quantity],
          ]
        : [
            ["Organization", organization],
            ["Type of Bid", cleanCell(getField(raw, headerMap, "Type of Bid"))],
            [
              "Contract Period",
              cleanCell(getField(raw, headerMap, "Contract Period")),
            ],
            [
              "Similar Category",
              cleanCell(getField(raw, headerMap, "Similar Category")),
            ],
          ];

    let pqCriteria =
      tenderType === "GeM"
        ? buildGemPqCriteria(raw, headerMap, checklist)
        : checklist;
    if (!pqCriteria) {
      pqCriteria = "Review required - refer tender document";
    }

    const row = emptyTenderImportRow({
      tender247Id: t247Id,
      gemEprocureId: referenceNo,
      tenderName: brief,
      portalLink: "",
      source: "bidassist",
      tenderType,
      lastDate: deadlineParsed.value,
      location,
      msmeExempted: normalizeYesNo(getField(raw, headerMap, "MSME Exemption")),
      startupExempted: normalizeYesNo(
        getField(raw, headerMap, "Startup Exemption"),
      ),
      tenderEstimatedCost: estimatedCost,
      tenderFees: parseAmount(getField(raw, headerMap, "Document fees")),
      emdAmount: parseAmount(getField(raw, headerMap, "EMD")),
      status: "new",
      tenderNotes: buildNotes(noteLines),
      pqCriteria,
    });

    if (!row.tenderName || shouldSkipSparseRow(row)) {
      rowsSkipped += 1;
      continue;
    }

    rows.push(row);
    rowsMapped += 1;
  }

  return { rows, rowsRead, rowsMapped, rowsSkipped, warnings };
}

function buildGemPqCriteria(
  raw: Record<string, unknown>,
  headerMap: Map<string, string>,
  checklist: string,
): string {
  const lines: string[] = [];
  const turnover = cleanCell(
    getField(raw, headerMap, "Minimum Average Annual Turnover of the bidder"),
  );
  const pastExp = cleanCell(
    getField(
      raw,
      headerMap,
      "Years of Past Experience Required for same/similar service",
    ),
  );
  const similarPast = cleanCell(
    getField(raw, headerMap, "Past Experience of Similar Services required"),
  );
  const docsFromSeller = cleanCell(
    getField(raw, headerMap, "Document required from seller"),
  );
  const eligibility = cleanCell(
    getField(raw, headerMap, "Eligibility Criteria"),
  );

  if (turnover) {
    lines.push(`Minimum Average Annual Turnover: ${turnover}`);
  }
  if (pastExp) {
    lines.push(`Past Experience Required: ${pastExp}`);
  }
  if (similarPast) {
    lines.push(`Past Experience of Similar Services: ${similarPast}`);
  }
  if (docsFromSeller) {
    lines.push(`Document Required From Seller: ${docsFromSeller}`);
  }
  if (eligibility) {
    lines.push(`Eligibility Criteria: ${eligibility}`);
  }
  if (checklist) {
    lines.push(`Checklist:\n${checklist}`);
  }
  return lines.join("\n");
}
