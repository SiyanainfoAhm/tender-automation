import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import XLSX from "xlsx";
import {
  applyScreeningDecisionsToWorkbook,
  inventoryTenderWorkbook,
} from "../applyScreeningDecisionsToWorkbook.js";
import type { ScreeningDecision } from "../screeningDecisionSchema.js";
import { readRunWorkbook } from "../runWorkbook.js";

function writeMultiSheet(filePath: string): void {
  const workbook = XLSX.utils.book_new();
  const gem = XLSX.utils.aoa_to_sheet([
    ["T247 ID", "TENDER BRIEF", "Organization", "Value"],
    ["1001", "Hardware PC", "Dept A", "100000"],
    ["1002", "Website CMS", "Dept B", "200000"],
  ]);
  const nonGem = XLSX.utils.aoa_to_sheet([
    ["T247 ID", "TENDER BRIEF", "Organization", "ESTIMATED COST"],
    ["2001", "Mobile app", "Dept C", "300000"],
    ["2002", "Scanning services", "Dept D", "400000"],
  ]);
  XLSX.utils.book_append_sheet(workbook, gem, "GeM Tenders");
  XLSX.utils.book_append_sheet(workbook, nonGem, "Non-GeM Tenders");
  XLSX.writeFile(workbook, filePath);
}

test("applyScreeningDecisionsToWorkbook preserves all Gem/Non-Gem rows", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screening-apply-"));
  const source = path.join(dir, "Tender247_test.xlsx");
  const output = path.join(dir, "run-screened-siyana.xlsx");
  writeMultiSheet(source);

  const inventory = await inventoryTenderWorkbook(source);
  assert.equal(inventory.totalRows, 4);
  assert.deepEqual(inventory.tenderSheetNames.sort(), [
    "GeM Tenders",
    "Non-GeM Tenders",
  ].sort());

  const decisions: ScreeningDecision[] = [
    {
      t247Id: "1001",
      screeningStatus: "NO_BID",
      screeningReason: "hardware",
      statusEnum: "NO_GO",
    },
    {
      t247Id: "1002",
      screeningStatus: "MAY_BID",
      screeningReason: "software",
      statusEnum: "CONDITIONAL_GO",
    },
    // 2001 intentionally missing → VERIFY
    {
      t247Id: "2002",
      screeningStatus: "NO_BID",
      screeningReason: "excluded",
      statusEnum: "NO_GO",
    },
  ];

  const applied = await applyScreeningDecisionsToWorkbook({
    sourceWorkbookPath: source,
    outputPath: output,
    decisions,
  });

  assert.equal(applied.inputTotalRows, 4);
  assert.equal(applied.outputTotalRows, 4);
  assert.deepEqual(applied.missingTenderIds, ["2001"]);

  const outInventory = await inventoryTenderWorkbook(output);
  assert.equal(outInventory.totalRows, 4);
  assert.deepEqual(outInventory.sheetNames, inventory.sheetNames);

  const rows = readRunWorkbook(output);
  assert.equal(rows.length, 4);
  const byId = new Map(
    rows.map((r) => [r.tender247Id || r.canonicalId.replace(/\D/g, ""), r]),
  );
  assert.equal(byId.get("1001")?.screeningStatus, "NO_GO");
  assert.equal(byId.get("1002")?.screeningStatus, "CONDITIONAL_GO");
  assert.equal(byId.get("2001")?.screeningStatus, "VERIFY");
  assert.match(
    byId.get("2001")?.screeningReason ?? "",
    /AI response missing tender mapping/,
  );
  assert.equal(byId.get("2002")?.screeningStatus, "NO_GO");
});
