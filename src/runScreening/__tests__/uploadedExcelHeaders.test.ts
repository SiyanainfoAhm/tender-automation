import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import XLSX from "xlsx";

import {
  parseExemptionFlag,
  parseSourceWorkbook,
  workbookLooksPreScreened,
} from "../runWorkbook.js";

test("uploaded Excel headers map T247 ID2 / Estimated Value / Decision Reason", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-excel-"));
  const filePath = path.join(dir, "upload.xlsx");
  const aoa = [
    [
      "T247 ID2",
      "Portal",
      "Reference No.",
      "Tender Brief",
      "Tender Category",
      "Estimated Value",
      "Deadline",
      "Location",
      "EMD",
      "MSME Exemption",
      "Startup Exemption",
      "Status",
      "Decision Reason",
    ],
    [
      "103544061",
      "Tender247",
      "REF-1",
      "Website redesign",
      "Website / Web Portal",
      "1000000",
      "2026-09-01",
      "Mumbai, Maharashtra",
      "25000",
      "Yes",
      "No",
      "No Bid",
      "Outside preferred geography",
    ],
    [
      "103544062",
      "Tender247",
      "REF-2",
      "Mobile app build",
      "Mobile App",
      "2500000",
      "2026-09-10",
      "Chennai",
      "50000",
      "No",
      "Yes",
      "May Bid",
      "Fits preferred scope with conditions",
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Tenders");
  XLSX.writeFile(workbook, filePath);

  const rows = parseSourceWorkbook(filePath, "TENDER247");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.tender247Id, "103544061");
  assert.equal(rows[0]!.referenceNo, "REF-1");
  assert.equal(rows[0]!.bidAssistId, "");
  assert.equal(rows[0]!.tenderName, "Website redesign");
  assert.equal(rows[0]!.estimatedCost, "1000000");
  assert.equal(rows[0]!.location, "Mumbai, Maharashtra");
  assert.equal(rows[0]!.emdAmount, "25000");
  assert.equal(rows[0]!.screeningStatus, "NO_GO");
  assert.equal(rows[0]!.screeningReason, "Outside preferred geography");
  assert.equal(rows[0]!.tenderCategory, "Website / Web Portal");
  assert.equal(rows[0]!.msmeExemption, true);
  assert.equal(rows[0]!.startupExemption, false);
  assert.equal(rows[0]!.source, "TENDER247");

  assert.equal(rows[1]!.screeningStatus, "CONDITIONAL_GO");
  assert.equal(rows[1]!.msmeExemption, false);
  assert.equal(rows[1]!.startupExemption, true);
  assert.equal(workbookLooksPreScreened(rows), true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("headerless Final_Aug-style upload parses Status column without titles", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-headerless-"));
  const filePath = path.join(dir, "Final_Aug.xlsx");
  const aoa = [
    [
      103069974,
      "Tender247",
      "2026_ED_30869_1",
      "SOC implementation for SLDC",
      "₹19,44,00,000",
      45928,
      "North Goa, Goa, India",
      "₹38,88,000",
      "-",
      20,
      "NO_BID",
      "EMD exceeds limit",
    ],
    [
      102181599,
      "Tender247",
      "2026_RISL_574346_1",
      "Disaster management system",
      "₹4,25,00,000",
      45934,
      "Jaipur, Rajasthan, India",
      "₹8,50,000",
      "-",
      20,
      "NO_BID",
      "Outside scope",
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "21 22 23");
  XLSX.writeFile(workbook, filePath);

  const rows = parseSourceWorkbook(filePath, "TENDER247");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.tender247Id, "103069974");
  assert.equal(rows[0]!.referenceNo, "2026_ED_30869_1");
  assert.equal(rows[0]!.screeningStatus, "NO_GO");
  assert.equal(rows[0]!.screeningReason, "EMD exceeds limit");
  assert.equal(rows[0]!.location, "North Goa, Goa, India");
  assert.equal(workbookLooksPreScreened(rows), true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("GPT output with empty Screening Status falls back to Status column", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-dual-status-"));
  const filePath = path.join(dir, "daily.xlsx");
  const aoa = [
    [
      "T247 ID",
      "TENDER BRIEF",
      "Organization",
      "EMD",
      "Screening Status",
      "Screening Reason",
      "Tender Category",
      "Status",
      "Decision Reason",
    ],
    [
      "101466917",
      "Core banking maintenance",
      "Uco Bank",
      "100000000",
      "",
      "",
      "Financial Threshold Exceeded",
      "NO_BID",
      "EMD exceeds Siyana limit",
    ],
    [
      "103862135",
      "Website redesign",
      "Dept",
      "50000",
      "DUPLICATE",
      "Duplicate Tender247 ID: 103862135",
      "",
      "DUPLICATE",
      "Duplicate Tender247 ID: 103862135",
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Final Analysis");
  XLSX.writeFile(workbook, filePath);

  const rows = parseSourceWorkbook(filePath, "TENDER247");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.screeningStatus, "NO_GO");
  assert.equal(rows[0]!.screeningReason, "EMD exceeds Siyana limit");
  assert.equal(rows[1]!.screeningStatus, "DUPLICATE");
  assert.equal(rows[1]!.screeningReason, "Duplicate Tender247 ID: 103862135");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("parseExemptionFlag handles Yes/No blanks", () => {
  assert.equal(parseExemptionFlag("Yes"), true);
  assert.equal(parseExemptionFlag("NO"), false);
  assert.equal(parseExemptionFlag(""), null);
});
