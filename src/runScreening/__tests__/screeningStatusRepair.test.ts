import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import XLSX from "xlsx";
import { SIYANA_COMPANY_ID } from "../../company/siyanaCompany.js";
import type { CompanyPreferenceSnapshot } from "../companyPreferences.js";
import {
  readRunWorkbook,
  validateScreenedWorkbook,
  writeRunWorkbook,
  type RunWorkbookRow,
} from "../runWorkbook.js";
import {
  repairMissingScreeningStatuses,
  saveScreeningRepairLog,
} from "../screeningStatusRepair.js";

function snapshot(): CompanyPreferenceSnapshot {
  return {
    company: {
      id: SIYANA_COMPANY_ID,
      name: "Siyana Info Solutions Pvt. Ltd.",
      industryType: "IT / Software",
      businessLocation: "Chennai",
      website: null,
      yearEstablished: 2014,
      description: "Software services",
      slug: "siyana",
    },
    preferences: {
      companyId: SIYANA_COMPANY_ID,
      maxEmdInr: 1_500_000,
      minTenderValueInr: 0,
      maxTenderValueInr: 50_000_000,
      serviceScope: ["Software Development", "Website Development"],
      excludedScope: ["NON-IT", "Hardware Only", "EOI / Expression of Interest"],
      extras: {},
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
    loadedAt: "2026-08-20T00:00:00.000Z",
  };
}

function baseRow(overrides: Partial<RunWorkbookRow> = {}): RunWorkbookRow {
  return {
    canonicalId: "T247-103493316",
    source: "TENDER247",
    tender247Id: "103493316",
    referenceNo: "",
    bidAssistId: "",
    tenderName:
      "expression of interest (eoi) for selection of partner for servers, san storage, router and sql server licences",
    organization: "Railtel",
    location: "Chandigarh",
    deadline: "24-08-2026",
    estimatedCost: "192000000",
    emdAmount: "500000",
    sourceRefs: "TENDER247",
    screeningStatus: "",
    screeningReason: "",
    classification: {
      tenderType: "EOI",
      primaryScope: "HARDWARE_INFRASTRUCTURE",
      procurementModel: "COTS_LICENSE",
      dominantScope: "hardware/product",
      preferredScopeMatch: "NO",
      hardGateFailed: true,
      classificationConfidence: "HIGH",
      flags: {
        EOI: true,
        "COTS / Product / Licence": true,
        "Hardware Dominant": true,
        "OEM Dependency": false,
        "Partner / JV Dependency": true,
        "Hard Gate Failed": true,
      },
    },
    ...overrides,
  };
}

test("repair fills empty status from GPT classification flags without touching valid rows", () => {
  const logs: string[] = [];
  const good: RunWorkbookRow = {
    ...baseRow({
      canonicalId: "T247-1001",
      tender247Id: "1001",
      tenderName: "CMS website redesign",
      screeningStatus: "CONDITIONAL_GO",
      screeningReason: "Preferred website scope",
      classification: undefined,
    }),
  };
  const broken = baseRow();
  const { rows, repaired } = repairMissingScreeningStatuses({
    inputRows: [good, broken],
    outputRows: [good, broken],
    snapshot: snapshot(),
    runDate: "2026-08-20",
    log: (message) => logs.push(message),
  });

  assert.equal(repaired.length, 1);
  assert.equal(repaired[0]?.tenderId, "T247-103493316");
  assert.equal(repaired[0]?.newStatus, "NO_BID");
  assert.equal(rows[0]?.screeningStatus, "CONDITIONAL_GO");
  assert.equal(rows[0]?.screeningReason, "Preferred website scope");
  assert.equal(rows[1]?.screeningStatus, "NO_GO");
  assert.match(rows[1]?.screeningReason || "", /EOI|hardware|COTS|partner/i);
  assert.ok(logs.some((line) => line === "SCREENING_MISSING_STATUS_COUNT=1"));
  assert.ok(logs.some((line) => line === "SCREENING_STATUS_REPAIR"));
  assert.ok(logs.some((line) => line === "NEW_STATUS=NO_BID"));
});

test("validateScreenedWorkbook allows missing status then local repair continues", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screening-repair-"));
  const inputRows: RunWorkbookRow[] = [
    baseRow({
      canonicalId: "T247-1001",
      tender247Id: "1001",
      tenderName: "CMS website",
      screeningStatus: "",
      screeningReason: "",
      classification: undefined,
      estimatedCost: "1000000",
      emdAmount: "10000",
    }),
    baseRow(),
  ];
  const normalizedPath = path.join(dir, "run-normalized.xlsx");
  writeRunWorkbook(
    inputRows.map((row) => ({ ...row, screeningStatus: "", screeningReason: "" })),
    normalizedPath,
  );
  const input = readRunWorkbook(normalizedPath);

  const outPath = path.join(dir, "screening", "run-screened-siyana.xlsx");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const analysis = XLSX.utils.aoa_to_sheet([
    [
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
      "Tender Type",
      "EOI",
      "Hardware Dominant",
      "COTS / Product / Licence",
      "Partner / JV Dependency",
      "Hard Gate Failed",
      "Preferred Scope Match",
    ],
    [
      "T247-1001",
      "1001",
      "",
      "CMS website redesign and development",
      "TENDER247",
      "Dept",
      "TN",
      "2026-09-01",
      "1000000",
      "10000",
      "TENDER247",
      "MAY_BID",
      "Preferred website scope",
      "TENDER",
      "NO",
      "NO",
      "NO",
      "NO",
      "NO",
      "YES",
    ],
    [
      "T247-103493316",
      "103493316",
      "",
      "expression of interest (eoi) for servers and licences",
      "TENDER247",
      "Railtel",
      "CH",
      "24-08-2026",
      "192000000",
      "500000",
      "TENDER247",
      "",
      "",
      "EOI",
      "YES",
      "YES",
      "YES",
      "YES",
      "YES",
      "NO",
    ],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, analysis, "Current Analysis");
  XLSX.writeFile(wb, outPath);

  const logs: string[] = [];
  const validated = validateScreenedWorkbook({
    inputRows: input,
    outputPath: outPath,
    allowMissingStatus: true,
  });
  assert.equal(validated.missingStatusIds.length, 1);
  const repaired = repairMissingScreeningStatuses({
    inputRows: input,
    outputRows: validated.outputRows,
    snapshot: snapshot(),
    runDate: "2026-08-20",
    log: (message) => logs.push(message),
  });
  writeRunWorkbook(repaired.rows, outPath);
  saveScreeningRepairLog(dir, {
    runId: "RUN-2026-08-20",
    repairedRows: repaired.repaired,
    gptRows: repaired.rows.length,
    screenedRows: repaired.rows.length,
    validStatusRows: repaired.rows.filter((row) => Boolean(row.screeningStatus)).length,
    updatedAt: new Date().toISOString(),
  });

  assert.equal(repaired.repaired.length, 1);
  assert.ok(repaired.rows.every((row) => Boolean(row.screeningStatus)));
  const fixed = repaired.rows.find((row) => row.canonicalId === "T247-103493316");
  assert.equal(fixed?.screeningStatus, "NO_GO");
  assert.equal(
    repaired.rows.find((row) => row.canonicalId === "T247-1001")?.screeningStatus,
    "CONDITIONAL_GO",
  );
  assert.ok(logs.includes("SCREENING_MISSING_STATUS_COUNT=1"));
  assert.ok(fs.existsSync(path.join(dir, "screening", "screening-repair-log.json")));
});
