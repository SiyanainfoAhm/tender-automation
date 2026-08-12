/**
 * One-off fixture check for 2026-08-11 Excel financial gate.
 * Not part of production — run via: npx tsx src/finance/__tests__/runFixtureFinancialCheck.ts
 */
import path from "node:path";
import { parseTender247DailyExcelRows } from "../../tender247Batch/parseDailyExcelRows.js";
import {
  applyExcelEarlyFinancialFilter,
  evaluateExcelFinancialGate,
} from "../../tender247Batch/excelEarlyFinancialFilter.js";

const excelPath = path.resolve(
  "downloads/2026-08-11/Tender247_2026-08-11.xlsx",
);
const parsed = parseTender247DailyExcelRows(excelPath);
const summary = applyExcelEarlyFinancialFilter(parsed.rows);
const target = parsed.rows.find((r) => r.sourceTenderId === "103201275");
if (!target) {
  console.error("MISSING_TENDER=103201275");
  process.exit(1);
}
const decision = evaluateExcelFinancialGate(target);
const uniqueDrops =
  summary.droppedByTenderValue +
  summary.droppedByEmd +
  summary.droppedByBoth;

console.log(`TOTAL_ROWS=${summary.excelRows}`);
console.log(`FINANCIAL_DROP_UNIQUE=${uniqueDrops}`);
console.log(`FINANCIAL_SURVIVORS=${summary.detailCrawlsRequired}`);
console.log(`RAW_TENDER_VALUE=${decision.rawTenderValue}`);
console.log(`PARSED_TENDER_VALUE_INR=${decision.parsedTenderValueInr}`);
console.log(`RAW_EMD=${decision.rawEmd}`);
console.log(`PARSED_EMD_INR=${decision.parsedEmdInr}`);
console.log(`FINANCIAL_STATUS=${decision.status}`);
console.log(`FINANCIAL_REASON=${decision.reasonCode}`);

const ok =
  summary.excelRows === 159 &&
  uniqueDrops === 16 &&
  summary.detailCrawlsRequired === 143 &&
  decision.parsedTenderValueInr === 56_261_544 &&
  decision.parsedEmdInr === 1_125_231 &&
  decision.status === "DROP" &&
  decision.reasonCode === "TENDER_VALUE_ABOVE_LIMIT";

console.log(`FIXTURE_OK=${ok}`);
process.exit(ok ? 0 : 1);
