import XLSX from "xlsx";
import { parseSourceWorkbook } from "../src/runScreening/runWorkbook.js";
import { normalizePhase1ScreeningStatus } from "../src/runScreening/phase1Statuses.js";
import { dailyScreeningOutputFilename } from "../src/runScreening/buildDailyScreeningOperatorPrompt.js";

function analyze(filePath: string, date: string): void {
  const rows = parseSourceWorkbook(filePath, "TENDER247");
  const wb = XLSX.readFile(filePath);
  console.log(`\n=== ${date} ${filePath} ===`);
  console.log("sheets:", wb.SheetNames.join(", "));
  for (const sn of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sn], {
      header: 1,
      defval: "",
    }) as unknown[][];
    console.log(`  sheet "${sn}": ${Math.max(0, matrix.length - 1)} data rows`);
  }
  console.log("parsed rows:", rows.length);

  const noStatus = rows.filter((r) => !r.screeningStatus);
  console.log("rows without status:", noStatus.length);
  for (const r of noStatus.slice(0, 10)) {
    console.log("  ", r.tender247Id || r.canonicalId, r.tenderName?.slice(0, 60));
  }

  const dup = new Map<string, number>();
  for (const r of rows) {
    const id = r.tender247Id || r.bidAssistId || r.canonicalId;
    dup.set(id, (dup.get(id) || 0) + 1);
  }
  const dups = [...dup.entries()].filter(([, c]) => c > 1);
  console.log("duplicate source ids:", dups.length);
  for (const [id, c] of dups.slice(0, 10)) {
    console.log("  ", id, "x", c);
  }

  const noId = rows.filter((r) => !r.tender247Id && !r.bidAssistId);
  console.log("rows without T247/BidAssist id:", noId.length);
  for (const r of noId.slice(0, 10)) {
    console.log("  ", r.canonicalId, r.tenderName?.slice(0, 50));
  }

  const invalid = rows.filter(
    (r) => r.screeningStatus && !normalizePhase1ScreeningStatus(r.screeningStatus),
  );
  console.log("invalid status (should be 0):", invalid.length);
}

const dates = ["2026-08-29", "2026-08-30"];
for (const date of dates) {
  const name = dailyScreeningOutputFilename(date);
  analyze(`downloads/${date}/screening/${name}`, date);
}
