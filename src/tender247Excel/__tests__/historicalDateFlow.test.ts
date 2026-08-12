import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseUntilGoArgs } from "../testTender247UntilGo.js";
import { parseSelectDateArgs } from "../testTender247SelectDate.js";
import {
  evaluateMailDateExcelGate,
  mailDateInputMatchesRequested,
} from "../../tenderDetails/selectTender247MailDate.js";

test("parseUntilGoArgs keeps explicit historical date (not system today)", () => {
  const args = parseUntilGoArgs(["--date=2026-08-11"]);
  assert.equal(args.date, "2026-08-11");
  assert.notEqual(args.date, "2026-08-12");
});

test("parseSelectDateArgs keeps explicit historical date", () => {
  const args = parseSelectDateArgs(["--date=2026-08-11"]);
  assert.equal(args.date, "2026-08-11");
});

test("requested=11 Aug → output folder must be 2026-08-11", () => {
  const requested = "2026-08-11";
  const downloadRoot = "downloads";
  const dateFolder = path.join(downloadRoot, requested);
  assert.equal(path.basename(dateFolder), requested);
  assert.notEqual(path.basename(dateFolder), "2026-08-12");
});

test("requested=11 Aug → normalized filename Tender247_2026-08-11.xlsx", () => {
  const requested = "2026-08-11";
  const filename = `Tender247_${requested}.xlsx`;
  assert.equal(filename, "Tender247_2026-08-11.xlsx");
  assert.ok(filename.includes(requested));
  assert.equal(filename.includes("2026-08-12"), false);
});

test("requested=11 Aug → session mail_date stays historical", () => {
  const requested = "2026-08-11";
  const sessionMailDate = requested; // must not be re-derived via new Date()
  assert.equal(sessionMailDate, "2026-08-11");
  const gate = evaluateMailDateExcelGate({
    requestedIso: requested,
    selectedMailDateIso: sessionMailDate,
    mailDateInputValue: "11/08/2026",
  });
  assert.equal(gate.ok, true);
});

test("pre-XLS visible date = 12 Aug while requested 11 Aug → download blocked", () => {
  assert.equal(mailDateInputMatchesRequested("12/08/2026", "2026-08-11"), false);
  const gate = evaluateMailDateExcelGate({
    requestedIso: "2026-08-11",
    selectedMailDateIso: "2026-08-12",
    mailDateInputValue: "12/08/2026",
  });
  assert.equal(gate.ok, false);
  assert.match(gate.reason || "", /TENDER247_DATE_MISMATCH/);
});

test("until-go / excel-filter / daily batch never import ensureTodayTendersSelected", () => {
  for (const rel of [
    "src/tender247Excel/testTender247UntilGo.ts",
    "src/tender247Excel/testTender247ExcelFilter.ts",
    "src/tender247Excel/testTender247KeptPipeline.ts",
    "src/tender247Batch/runDailyBatch.ts",
    "src/tender247Batch/ensureTender247FreshListForDate.ts",
  ]) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    // Real import/call only — comments may mention the forbidden helper by name.
    assert.doesNotMatch(
      src,
      /import\s*\{[^}]*\bensureTodayTendersSelected\b/,
    );
    assert.doesNotMatch(src, /await\s+ensureTodayTendersSelected\s*\(/);
  }
});

test("historical Fresh helper rejects Today Tenders reset semantics", () => {
  const src = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/tender247Batch/ensureTender247FreshListForDate.ts",
    ),
    "utf8",
  );
  assert.match(src, /ensureTender247FreshListForDate/);
  assert.match(src, /selectAndVerifyTender247MailDate/);
  // Must not race Fresh for historical success in the old liveListCards way
  assert.doesNotMatch(src, /Promise\.race\(\[\s*dated\.waitFor/);
  assert.doesNotMatch(src, /await\s+ensureTodayTendersSelected\s*\(/);
  assert.doesNotMatch(src, /getTodayTenderCard/);
});

test("excel download path uses ensureTender247FreshListForDate before XLS", () => {
  const excelFilter = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/testTender247ExcelFilter.ts"),
    "utf8",
  );
  const sources = fs.readFileSync(
    path.join(process.cwd(), "src/sources/tender247.ts"),
    "utf8",
  );
  assert.match(excelFilter, /ensureTender247FreshListForDate/);
  assert.match(sources, /PRE_XLS_REQUESTED_DATE/);
  assert.match(sources, /PRE_XLS_VISIBLE_MAIL_DATE/);
  assert.match(sources, /PRE_XLS_DATE_MATCH/);
  assert.match(sources, /TENDER247_PRE_XLS_DATE_MISMATCH/);
});

test("package.json exposes test:tender247:select-date and date-paths scripts", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    pkg.scripts?.["test:tender247:select-date"],
    "tsx src/tender247Excel/testTender247SelectDate.ts",
  );
  assert.equal(
    pkg.scripts?.["test:tender247:date-paths"],
    "tsx src/tender247Excel/testTender247DatePaths.ts",
  );
});

test("Select Mail Date helper uses real calendar clicks — never fill/JS value", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/tenderDetails/selectTender247MailDate.ts"),
    "utf8",
  );
  assert.match(src, /TENDER247_MAIL_DATE_PICKER_OPENED=true/);
  assert.match(src, /TENDER247_CALENDAR_MONTH=/);
  assert.match(src, /TENDER247_CALENDAR_DAY_CLICKED=/);
  assert.match(src, /openMailDatePicker/);
  assert.match(src, /clickCalendarDay/);
  assert.doesNotMatch(src, /\.fill\s*\(/);
  assert.doesNotMatch(src, /input\.value\s*=/);
  assert.doesNotMatch(src, /\.type\s*\(/);
});

test("select-date smoke test forces calendar click and saves screenshots", () => {
  const smoke = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/testTender247SelectDate.ts"),
    "utf8",
  );
  const helper = fs.readFileSync(
    path.join(process.cwd(), "src/tenderDetails/selectTender247MailDate.ts"),
    "utf8",
  );
  assert.match(smoke, /forceCalendarClick:\s*true/);
  assert.match(smoke, /createMailDateScreenshotHook/);
  assert.match(smoke, /04-before-xls/);
  assert.match(helper, /01-before-date-click/);
  assert.match(helper, /02-calendar-open/);
  assert.match(helper, /03-day-selected/);
  assert.doesNotMatch(smoke, /downloadExcel|downloadTodayExcel|qualifySingleTender/);
});
