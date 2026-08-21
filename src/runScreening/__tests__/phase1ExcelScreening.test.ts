/**
 * Phase-1 run-level Excel screening: deterministic dedupe locally,
 * ChatGPT assigns statuses, NO_GO never enters the Tender247 detail queue.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import XLSX from "xlsx";
import { SIYANA_COMPANY_ID } from "../../company/siyanaCompany.js";
import { AutomationError } from "../../browserUtils.js";
import { buildTenderScreeningPrompt } from "../buildScreeningPrompt.js";
import {
  hashPreferenceSnapshot,
  type CompanyPreferenceSnapshot,
} from "../companyPreferences.js";
import {
  normalizePhase1ScreeningStatus,
} from "../phase1Statuses.js";
import {
  runPhase1ExcelScreening,
} from "../runPhase1ExcelScreening.js";
import {
  readRunWorkbook,
  RUN_NORMALIZED_FILE,
  RUN_SCREENED_FILE,
  ScreeningOutputInvalidError,
  writeRunWorkbook,
} from "../runWorkbook.js";
import {
  assertAiScreeningCompleteForDetailCrawl,
  loadRunState,
  loadScreeningManifest,
  loadIngestionCounts,
} from "../screeningManifest.js";

function snapshot(
  overrides?: Partial<CompanyPreferenceSnapshot["preferences"]>,
): CompanyPreferenceSnapshot {
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
      minTenderValueInr: null,
      maxTenderValueInr: 50_000_000,
      serviceScope: ["Website development", "Mobile applications"],
      excludedScope: ["scanning / digitization"],
      extras: { localOfficeRequired: false },
      updatedAt: "2026-08-18T00:00:00.000Z",
      ...overrides,
    },
    loadedAt: "2026-08-18T00:00:00.000Z",
  };
}

function writeSourceWorkbook(
  filePath: string,
  rows: Array<{ id: string; name: string; org?: string }>,
  idHeader: string,
): void {
  const aoa: unknown[][] = [
    [idHeader, "TENDER BRIEF", "Organization", "ESTIMATED COST", "EMD"],
    ...rows.map((row) => [row.id, row.name, row.org ?? "Dept", "1000000", "50000"]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Tenders");
  XLSX.writeFile(workbook, filePath);
}

function statusForId(id: string): {
  status: string;
  reason: string;
} {
  const n = Number(id);
  if (n >= 1001 && n <= 1008) {
    return {
      status: "NO_GO",
      reason: "NO_BID — Pure hardware procurement; outside configured software-service preference.",
    };
  }
  if (n >= 1009 && n <= 1013) {
    return {
      status: "VERIFY",
      reason:
        "VERIFY — Similar-project eligibility cannot be established from available Excel data; detailed tender documents required.",
    };
  }
  if (n >= 1014 && n <= 1017) {
    return {
      status: "CONDITIONAL_GO",
      reason: "MAY_BID — Software scope matches; financials need document confirmation.",
    };
  }
  return {
    status: "GO",
    reason: "WILL_BID — Website / software development clearly in preferred scope.",
  };
}

function assignStatusesFromInput(inputPath: string, outputPath: string, dropLast = 0): void {
  const rows = readRunWorkbook(inputPath);
  const kept = dropLast > 0 ? rows.slice(0, Math.max(0, rows.length - dropLast)) : rows;
  writeRunWorkbook(
    kept.map((row) => {
      const assigned = statusForId(row.tender247Id || row.canonicalId.replace(/\D/g, ""));
      return {
        ...row,
        screeningStatus: normalizePhase1ScreeningStatus(assigned.status) ?? "VERIFY",
        screeningReason: assigned.reason,
      };
    }),
    outputPath,
  );
}

function fixtureDateFolder(): { dateFolder: string; t247Path: string; baPath: string } {
  const dateFolder = fs.mkdtempSync(path.join(os.tmpdir(), "phase1-screening-"));
  const t247Path = path.join(dateFolder, "Tender247_2026-08-18.xlsx");
  const baPath = path.join(dateFolder, "BidAssist_2026-08-18.xlsx");

  const t247Rows = Array.from({ length: 11 }, (_, i) => {
    const id = String(1001 + i);
    return { id, name: `Tender ${id}` };
  });
  t247Rows.push({ id: "1001", name: "Tender 1001 duplicate" });

  const baRows = Array.from({ length: 7 }, (_, i) => {
    const id = String(1012 + i);
    return { id, name: `Tender ${id}` };
  });
  baRows.push({ id: "1012", name: "Tender 1012 duplicate" });

  writeSourceWorkbook(t247Path, t247Rows, "T247 ID");
  writeSourceWorkbook(baPath, baRows, "Tender Id");
  return { dateFolder, t247Path, baPath };
}

test("normalizePhase1ScreeningStatus maps display aliases onto canonical enums", () => {
  assert.equal(normalizePhase1ScreeningStatus("No Bid"), "NO_GO");
  assert.equal(normalizePhase1ScreeningStatus("NO_BID"), "NO_GO");
  assert.equal(normalizePhase1ScreeningStatus("Verify"), "VERIFY");
  assert.equal(normalizePhase1ScreeningStatus("May Bid"), "CONDITIONAL_GO");
  assert.equal(normalizePhase1ScreeningStatus("Will Bid"), "GO");
});

test("preference snapshot hash and prompt change when database values change", () => {
  const runA = snapshot();
  const runB = snapshot({
    excludedScope: ["scanning / digitization", "internet / bandwidth"],
    extras: { localOfficeRequired: true },
  });
  const hashA = hashPreferenceSnapshot(runA);
  const hashB = hashPreferenceSnapshot(runB);
  assert.notEqual(hashA, hashB);

  const promptA = buildTenderScreeningPrompt({
    companySnapshot: runA,
    runDate: "2026-08-18",
    sourceExcelName: RUN_NORMALIZED_FILE,
    inputRowCount: 18,
  });
  const promptB = buildTenderScreeningPrompt({
    companySnapshot: runB,
    runDate: "2026-08-18",
    sourceExcelName: RUN_NORMALIZED_FILE,
    inputRowCount: 18,
  });
  assert.match(promptA, /Website development/);
  assert.match(promptA, /localOfficeRequired: false/);
  assert.doesNotMatch(promptA, /internet \/ bandwidth/);
  assert.match(promptB, /internet \/ bandwidth/);
  assert.match(promptB, /localOfficeRequired: true/);
  assert.notEqual(promptA, promptB);

  assert.match(promptA, /The database is authoritative/);
  assert.match(promptA, /FINANCIAL PREFERENCES/);
  assert.match(promptA, /PREFERRED SERVICE SCOPE/);
  assert.match(promptA, /EXCLUDED SCOPE/);
  assert.match(promptA, /Maximum EMD:\nINR 15,00,000/);
  assert.match(promptA, /Maximum Tender Value:\nINR 5,00,00,000/);
  assert.match(promptA, /Run correlation ID: RUN-2026-08-18/);
  assert.match(promptA, /Phase-1 screening policy version: SIYANA_PHASE1_V5/);
  assert.match(promptA, /\nNO_BID\nVERIFY\nMAY_BID\nWILL_BID\n/);
  assert.doesNotMatch(promptA, /Allowed Phase-1 statuses \(use these stored values/);
  assert.doesNotMatch(promptA, /Use NO_GO only/);
  assert.doesNotMatch(
    promptA,
    /Use VERIFY when the scope appears relevant but the Excel does not\n  contain enough information to determine qualification/,
  );
});

test("20 raw tenders dedupe to 18, ChatGPT returns 18, NO_GO never enters detail crawler", async () => {
  const { dateFolder, t247Path, baPath } = fixtureDateFolder();
  let chatgptCalls = 0;
  const result = await runPhase1ExcelScreening({
    dateFolder,
    dateIso: "2026-08-18",
    tender247ExcelPath: t247Path,
    bidAssistExcelPath: baPath,
    companySnapshot: snapshot(),
    persistResults: false,
    chatgptClient: {
      async screenWorkbook({ inputWorkbookPath, outputPath }) {
        chatgptCalls += 1;
        assignStatusesFromInput(inputWorkbookPath, outputPath);
        return outputPath;
      },
    },
  });

  assert.equal(chatgptCalls, 1);
  assert.equal(result.status, "complete");
  assert.equal(result.aiScreeningComplete, true);
  assert.equal(result.inputRows, 18);
  assert.equal(result.outputRows, 18);
  assert.equal(result.counts.NO_GO, 8);
  assert.equal(result.counts.VERIFY, 5);
  assert.equal(result.counts.CONDITIONAL_GO, 4);
  assert.equal(result.counts.GO, 1);
  assert.equal(result.tender247DetailIds.length, 10);
  assert.equal(result.noBidRows.length, 8);

  const noBidIds = result.noBidRows.map((row) => row.tender247Id);
  for (const id of ["1001", "1002", "1003", "1004", "1005", "1006", "1007", "1008"]) {
    assert.ok(noBidIds.includes(id), `NO_GO ${id} should be persisted locally`);
    assert.equal(
      result.tender247DetailIds.includes(id),
      false,
      `NO_GO ${id} must not enter Tender247 crawler`,
    );
  }
  for (const id of ["1009", "1010", "1011", "1012", "1013"]) {
    assert.ok(result.tender247DetailIds.includes(id), `VERIFY ${id} must enter crawler`);
  }
  for (const id of ["1014", "1015", "1016", "1017"]) {
    assert.ok(result.tender247DetailIds.includes(id), `MAY_BID ${id} must enter crawler`);
  }
  assert.ok(result.tender247DetailIds.includes("1018"), "WILL_BID 1018 must enter crawler");

  assert.ok(fs.existsSync(path.join(dateFolder, RUN_NORMALIZED_FILE)));
  assert.ok(fs.existsSync(path.join(dateFolder, "screening", RUN_SCREENED_FILE)));
  assert.ok(fs.existsSync(t247Path));
  assert.ok(fs.existsSync(baPath));

  const promptPath = path.join(dateFolder, "screening", "chatgpt-screening-prompt.txt");
  const prefsPath = path.join(dateFolder, "screening", "company-preferences-snapshot.json");
  assert.ok(fs.existsSync(promptPath));
  assert.ok(fs.existsSync(prefsPath));
  assert.match(fs.readFileSync(promptPath, "utf8"), /Siyana Info Solutions/);

  const screened = readRunWorkbook(path.join(dateFolder, "screening", RUN_SCREENED_FILE));
  assert.equal(screened.length, 18);
  const noBidScreened = screened.filter((row) => row.screeningStatus === "NO_GO");
  assert.equal(noBidScreened.length, 8);
  assert.ok(noBidScreened.every((row) => row.screeningReason.length > 12));

  const manifest = loadScreeningManifest(dateFolder);
  assert.equal(manifest?.status, "complete");
  assert.equal(manifest?.inputRows, 18);
  assert.equal(manifest?.outputRows, 18);
  assert.equal(manifest?.counts.NO_GO, 8);

  assertAiScreeningCompleteForDetailCrawl(dateFolder);

  const again = await runPhase1ExcelScreening({
    dateFolder,
    dateIso: "2026-08-18",
    tender247ExcelPath: t247Path,
    bidAssistExcelPath: baPath,
    companySnapshot: snapshot(),
    persistResults: false,
    chatgptClient: {
      async screenWorkbook() {
        chatgptCalls += 1;
        throw new Error("should resume, not call ChatGPT");
      },
    },
  });
  assert.equal(chatgptCalls, 1);
  assert.equal(again.tender247DetailIds.length, 10);
});

test("invalid ChatGPT workbook missing tenders blocks the detail crawler", async () => {
  const { dateFolder, t247Path, baPath } = fixtureDateFolder();
  await assert.rejects(
    () =>
      runPhase1ExcelScreening({
        dateFolder,
        dateIso: "2026-08-18",
        tender247ExcelPath: t247Path,
        bidAssistExcelPath: baPath,
        companySnapshot: snapshot(),
        persistResults: false,
        chatgptClient: {
          async screenWorkbook({ inputWorkbookPath, outputPath }) {
            assignStatusesFromInput(inputWorkbookPath, outputPath, 3);
            return outputPath;
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ScreeningOutputInvalidError);
      assert.equal(error.code, "SCREENING_OUTPUT_RECONCILIATION_FAILED");
      assert.match(error.message, /missing 3 tenders/);
      return true;
    },
  );

  const state = loadRunState(dateFolder);
  assert.equal(state?.aiScreeningComplete, false);
  assert.equal(state?.stage, "AI_SCREENING_FAILED");
  assert.throws(
    () => assertAiScreeningCompleteForDetailCrawl(dateFolder),
    /T247_DETAIL_CRAWL_BLOCKED/,
  );
});

test("assistant text with no XLSX is SCREENING_OUTPUT_MISSING and blocks crawl", async () => {
  const { dateFolder, t247Path, baPath } = fixtureDateFolder();
  await assert.rejects(
    () =>
      runPhase1ExcelScreening({
        dateFolder,
        dateIso: "2026-08-18",
        tender247ExcelPath: t247Path,
        bidAssistExcelPath: baPath,
        companySnapshot: snapshot(),
        persistResults: false,
        chatgptClient: {
          async screenWorkbook() {
            throw new AutomationError(
              "SCREENING_OUTPUT_MISSING",
              "SCREENING_OUTPUT_MISSING: assistant returned text but no workbook",
            );
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AutomationError);
      assert.equal(error.code, "SCREENING_OUTPUT_MISSING");
      return true;
    },
  );
  assert.throws(
    () => assertAiScreeningCompleteForDetailCrawl(dateFolder),
    /T247_DETAIL_CRAWL_BLOCKED/,
  );
  const ingested = loadIngestionCounts(dateFolder);
  assert.equal(ingested?.dailyRowsRaw, 12);
  assert.equal(ingested?.dailyRowsDeduped, 18);
});

test("skipChatGpt leaves SCREENING_PENDING and blocks detail crawl", async () => {
  const { dateFolder, t247Path, baPath } = fixtureDateFolder();
  const result = await runPhase1ExcelScreening({
    dateFolder,
    dateIso: "2026-08-18",
    tender247ExcelPath: t247Path,
    bidAssistExcelPath: baPath,
    companySnapshot: snapshot(),
    skipChatGpt: true,
  });
  assert.equal(result.status, "pending");
  assert.equal(result.aiScreeningComplete, false);
  assert.equal(result.tender247DetailIds.length, 0);
  assert.throws(
    () => assertAiScreeningCompleteForDetailCrawl(dateFolder),
    /T247_DETAIL_CRAWL_BLOCKED/,
  );
});

test("preference change invalidates resume and reruns screening", async () => {
  const { dateFolder, t247Path, baPath } = fixtureDateFolder();
  let chatgptCalls = 0;
  const client = {
    async screenWorkbook({
      inputWorkbookPath,
      outputPath,
    }: {
      inputWorkbookPath: string;
      outputPath: string;
    }) {
      chatgptCalls += 1;
      assignStatusesFromInput(inputWorkbookPath, outputPath);
      return outputPath;
    },
  };

  await runPhase1ExcelScreening({
    dateFolder,
    dateIso: "2026-08-18",
    tender247ExcelPath: t247Path,
    bidAssistExcelPath: baPath,
    companySnapshot: snapshot(),
    persistResults: false,
    chatgptClient: client,
  });
  await runPhase1ExcelScreening({
    dateFolder,
    dateIso: "2026-08-18",
    tender247ExcelPath: t247Path,
    bidAssistExcelPath: baPath,
    companySnapshot: snapshot({ maxEmdInr: 250_000 }),
    persistResults: false,
    chatgptClient: client,
  });
  assert.equal(chatgptCalls, 2);
});

test("runDailyBatch no longer imports the local company Excel prescreen", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "tender247Batch", "runDailyBatch.ts"),
    "utf8",
  );
  assert.equal(source.includes("applyTender247ExcelPrescreen"), false);
  assert.equal(source.includes("runPhase1ExcelScreening"), true);
  assert.equal(source.includes("TENDER247_LOCAL_COMPANY_FILTER_BYPASSED"), true);
});
