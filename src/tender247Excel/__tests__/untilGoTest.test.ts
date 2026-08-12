import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseUntilGoArgs } from "../testTender247UntilGo.js";
import {
  printUntilGoSummary,
  resolveUntilGoAuditDir,
  writeUntilGoCandidateAudit,
} from "../writeUntilGoAudit.js";

function fakeCandidate(id: string) {
  return {
    sourceTenderId: id,
    title: `Tender ${id}`,
    estimatedCostRaw: "1000000",
    parsedTenderValueInr: 1_000_000,
    emdRaw: "10000",
    parsedEmdInr: 10_000,
    deadline: "13-08-2026",
    excelFilterStatus: "KEEP",
    excelFilterReason: "WITHIN_FINANCIAL_LIMITS",
    rowIndex: 1,
  };
}

test("parseUntilGoArgs reads date", () => {
  const args = parseUntilGoArgs(["--date=2026-08-12"]);
  assert.equal(args.date, "2026-08-12");
});

test("parseUntilGoArgs supports --date value form", () => {
  const args = parseUntilGoArgs(["--date", "2026-08-11"]);
  assert.equal(args.date, "2026-08-11");
});

test("parseUntilGoArgs keeps explicit historical date", () => {
  const args = parseUntilGoArgs(["--date=2026-08-11"]);
  assert.equal(args.date, "2026-08-11");
  assert.notEqual(args.date, "2026-08-12");
});

test("parseUntilGoArgs rejects invalid date", () => {
  assert.throws(() => parseUntilGoArgs(["--date=bad"]), /Invalid --date/);
  assert.throws(() => parseUntilGoArgs(["--date=invalid"]), /Invalid --date/);
});

test("parseUntilGoArgs rejects empty --date=", () => {
  assert.throws(
    () => parseUntilGoArgs(["--date="]),
    /UNTIL_GO_INVALID_CLI_ARGS|Invalid --date/,
  );
});

test("parseUntilGoArgs rejects standalone -- (npm forwarding failure)", () => {
  assert.throws(
    () => parseUntilGoArgs(["--"]),
    /UNTIL_GO_INVALID_CLI_ARGS|standalone "--"/,
  );
});

test("parseUntilGoArgs empty argv may default to today (no mkdir)", () => {
  const prev = process.env.TENDER247_DATE;
  const prevDate = process.env.DATE;
  delete process.env.TENDER247_DATE;
  delete process.env.DATE;
  try {
    const args = parseUntilGoArgs([]);
    assert.match(args.date, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    if (prev !== undefined) process.env.TENDER247_DATE = prev;
    else delete process.env.TENDER247_DATE;
    if (prevDate !== undefined) process.env.DATE = prevDate;
    else delete process.env.DATE;
  }
});

test("package.json until-go script has no trailing --", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    pkg.scripts?.["test:tender247:until-go"],
    "tsx src/tender247Excel/testTender247UntilGo.ts",
  );
  assert.doesNotMatch(
    pkg.scripts?.["test:tender247:until-go"] || "",
    /\s--\s*$/,
  );
});

test("resolveUntilGoAuditDir uses until-go-audit folder", () => {
  const dir = resolveUntilGoAuditDir("downloads/2026-08-12", "103232437");
  assert.match(
    dir.replace(/\\/g, "/"),
    /downloads\/2026-08-12\/until-go-audit\/T247-103232437$/,
  );
});

test("writeUntilGoCandidateAudit writes six audit files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "until-go-audit-"));
  const dateFolder = path.join(root, "2026-08-12");
  const tenderFolder = path.join(dateFolder, "T247-111");
  fs.mkdirSync(tenderFolder, { recursive: true });
  fs.writeFileSync(
    path.join(tenderFolder, "qualification-prompt.txt"),
    "Evaluate this tender for Siyana",
    "utf8",
  );
  fs.writeFileSync(
    path.join(tenderFolder, "qualification-response.txt"),
    "raw assistant response",
    "utf8",
  );
  fs.writeFileSync(
    path.join(tenderFolder, "qualification-result.json"),
    JSON.stringify({ status: "NO_GO" }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(tenderFolder, "03-attachment-manifest.json"),
    JSON.stringify({
      expectedCount: 2,
      visibleCount: 2,
      filesAssignedCount: 2,
      uploadLimitWarningSeen: false,
      files: [],
    }),
    "utf8",
  );

  const auditDir = await writeUntilGoCandidateAudit({
    dateFolder,
    sourceTenderId: "111",
    candidate: fakeCandidate("111"),
    tenderFolder,
    supabaseExisting: true,
    documentsDownloaded: true,
    prescreenStatus: "PASSED",
    chatUrl: "https://chatgpt.com/c/example",
  });

  for (const name of [
    "01-prompt.txt",
    "02-metadata-sent-to-chatgpt.json",
    "03-attachment-manifest.json",
    "04-raw-chatgpt-response.txt",
    "05-parsed-qualification.json",
    "06-source-facts.json",
  ]) {
    assert.ok(fs.existsSync(path.join(auditDir, name)), `missing ${name}`);
  }

  const prompt = fs.readFileSync(path.join(auditDir, "01-prompt.txt"), "utf8");
  assert.match(prompt, /Evaluate this tender/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("printUntilGoSummary includes GO FOUND line", () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    printUntilGoSummary({
      excelRows: 10,
      financialDropped: 2,
      financialSurvivors: 8,
      relevanceChecked: 8,
      itRelevant: 3,
      nonIt: 2,
      ambiguous: 3,
      prescreenPassed: 2,
      prescreenRejected: 1,
      manualReview: 0,
      chatgptSubmitted: 2,
      noGo: 1,
      verify: 1,
      conditionalGo: 0,
      partnerBid: 0,
      go: 0,
      goFound: false,
      goTenderId: null,
      goChatUrl: null,
      goAuditFolder: null,
    });
  } finally {
    console.log = original;
  }
  assert.ok(lines.some((line) => line.includes("Tender247 UNTIL GO Validation")));
  assert.ok(lines.some((line) => line.includes("GO FOUND: NO")));
});

test("until-go module does not import BidAssist crawler", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/testTender247UntilGo.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /runBidassistCrawler|qualifyBidassistTender/);
});

test("until-go runner forces qualification reprocess", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/testTender247UntilGo.ts"),
    "utf8",
  );
  assert.match(src, /forceReprocess:\s*true/);
  assert.match(src, /GO_FOUND=true/);
  assert.match(src, /TENDER247_UNTIL_GO_TEST_START/);
});

test("until-go runner uses canonical qualifySingleTender only", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/testTender247UntilGo.ts"),
    "utf8",
  );
  assert.match(src, /runChatgptForPipelineCandidate/);
  assert.doesNotMatch(src, /uploadFilesToComposer|uploadQualificationAttachments/);
  assert.doesNotMatch(src, /prepareTenderSpecificUploadFiles/);
});

test("package.json exposes test:tender247:until-go script", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    pkg.scripts?.["test:tender247:until-go"],
    "tsx src/tender247Excel/testTender247UntilGo.ts",
  );
});

test("until-go / excel-filter / daily batch use shared mail-date helper", () => {
  const untilGo = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/testTender247UntilGo.ts"),
    "utf8",
  );
  const excelFilter = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/testTender247ExcelFilter.ts"),
    "utf8",
  );
  const batch = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Batch/runDailyBatch.ts"),
    "utf8",
  );
  assert.match(untilGo, /ensureTender247FreshListForDate/);
  assert.match(excelFilter, /ensureTender247FreshListForDate/);
  assert.match(batch, /ensureTender247FreshListForDate/);
  assert.match(excelFilter, /EXCEL_DOWNLOAD_REQUESTED_DATE|dateIso/);
});
