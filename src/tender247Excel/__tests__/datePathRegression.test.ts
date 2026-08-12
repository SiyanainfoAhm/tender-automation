import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AutomationError } from "../../browserUtils.js";
import {
  assertDateScopedPath,
  createTender247RunContext,
  resolveExcelFilterReviewDir,
  resolveExcelPath,
  resolvePlaywrightDownloadsDir,
  resolveTender247DateScopedPaths,
  resolveTenderFolder,
  resolveUntilGoAuditDir,
} from "../../tender247Batch/tender247RunContext.js";
import { playwrightDownloadsDir } from "../../tender247Batch/createTenderZip.js";
import { resolveDefaultKeptExcelPath } from "../parseKeptExcelRows.js";
import { resolveUntilGoAuditDir as resolveUntilGoAuditDirLegacy } from "../writeUntilGoAudit.js";

const REQUESTED = "2026-08-11";
const SYSTEM_TODAY = "2026-08-12";

test("run context paths stay on requested date (not system today)", () => {
  const ctx = createTender247RunContext("downloads", REQUESTED);
  assert.equal(ctx.requestedDate, REQUESTED);
  assert.match(ctx.downloadRoot.replace(/\\/g, "/"), /downloads\/2026-08-11$/);
  assert.doesNotMatch(ctx.downloadRoot.replace(/\\/g, "/"), /2026-08-12/);

  const paths = resolveTender247DateScopedPaths(ctx, "103227521");
  assert.match(paths.excelPath.replace(/\\/g, "/"), /downloads\/2026-08-11\/Tender247_2026-08-11\.xlsx$/);
  assert.match(paths.filterPath.replace(/\\/g, "/"), /downloads\/2026-08-11\/excel-filter-review$/);
  assert.match(paths.playwrightPath.replace(/\\/g, "/"), /downloads\/2026-08-11\/playwright-downloads$/);
  assert.match(paths.tenderPath.replace(/\\/g, "/"), /downloads\/2026-08-11\/T247-103227521$/);
  assert.match(paths.auditPath.replace(/\\/g, "/"), /downloads\/2026-08-11\/until-go-audit\/T247-103227521$/);

  for (const p of Object.values(paths)) {
    assert.equal(String(p).includes(SYSTEM_TODAY), false);
  }
});

test("legacy helpers agree with run-context resolvers", () => {
  const ctx = createTender247RunContext("downloads", REQUESTED);
  const norm = (p: string) => path.resolve(p).replace(/\\/g, "/");
  assert.equal(
    norm(resolveDefaultKeptExcelPath("downloads", REQUESTED)),
    norm(path.join(resolveExcelFilterReviewDir(ctx), "02-kept.xlsx")),
  );
  assert.equal(
    norm(resolveUntilGoAuditDirLegacy(ctx.downloadRoot, "103227521")),
    norm(resolveUntilGoAuditDir(ctx, "103227521")),
  );
  assert.equal(
    norm(playwrightDownloadsDir(ctx.downloadRoot)),
    norm(resolvePlaywrightDownloadsDir(ctx)),
  );
  assert.equal(
    resolveExcelPath(ctx),
    path.join(ctx.downloadRoot, `Tender247_${REQUESTED}.xlsx`),
  );
  assert.equal(
    resolveTenderFolder(ctx, "103227521"),
    path.join(ctx.downloadRoot, "T247-103227521"),
  );
});

test("assertDateScopedPath blocks wrong downloads date folder", () => {
  const ctx = createTender247RunContext("downloads", REQUESTED);
  assert.throws(
    () =>
      assertDateScopedPath(
        path.join(ctx.downloadsParent, SYSTEM_TODAY, "T247-1"),
        REQUESTED,
        ctx.downloadsParent,
      ),
    (error: unknown) =>
      error instanceof AutomationError &&
      error.code === "TENDER247_DATE_SCOPED_PATH_MISMATCH",
  );
  // Matching date is allowed
  assert.doesNotThrow(() =>
    assertDateScopedPath(
      path.join(ctx.downloadRoot, "playwright-downloads"),
      REQUESTED,
      ctx.downloadsParent,
    ),
  );
});

test("package.json exposes test:tender247:date-paths", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    pkg.scripts?.["test:tender247:date-paths"],
    "tsx src/tender247Excel/testTender247DatePaths.ts",
  );
});

test("qualification no longer derives dateIso via getTodayIsoDate", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/chatgptQualification/processTenderQualification.ts"),
    "utf8",
  );
  assert.match(src, /requestedDateFromDateFolder\(dateFolder\)/);
  assert.doesNotMatch(src, /const dateIso = getTodayIsoDate\(\)/);
});

test("until-go / excel-filter / kept-pipeline / daily batch create run context", () => {
  for (const rel of [
    "src/tender247Excel/testTender247UntilGo.ts",
    "src/tender247Excel/testTender247ExcelFilter.ts",
    "src/tender247Excel/testTender247KeptPipeline.ts",
    "src/tender247Batch/runDailyBatch.ts",
  ]) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    assert.match(src, /createTender247RunContext/);
    assert.match(src, /withTender247RunContextAsync/);
    assert.match(src, /TENDER247_RUN_REQUESTED_DATE/);
  }
});
