import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDailyScreeningOperatorPrompt,
  dailyScreeningOutputFilename,
  formatRunDateDdMmYy,
  writeScreeningMdPreferences,
} from "../buildDailyScreeningOperatorPrompt.js";
import {
  DEFAULT_SIYANA_SCREENING_CHAT_URL,
  isScreeningChatUrl,
  resolveScreeningChatUrl,
} from "../dailyScreeningChat.js";
import type { CompanyPreferenceSnapshot } from "../companyPreferences.js";

test("formatRunDateDdMmYy matches DD-MM-YY filename convention", () => {
  assert.equal(formatRunDateDdMmYy("2026-08-26"), "26-08-26");
  assert.equal(formatRunDateDdMmYy("2026-08-25"), "25-08-26");
  assert.equal(formatRunDateDdMmYy("2026-08-27"), "27-08-26");
});

test("operator prompt embeds shared-chat instructions and output filename", () => {
  const prompt = buildDailyScreeningOperatorPrompt({
    runDate: "2026-08-26",
    sourceExcelName: "Tender247_2026-08-26.xlsx",
    totalRowCount: 516,
    duplicateRowCount: 37,
  });
  assert.match(prompt, /Run Siyana Tender247 Daily Screening/);
  assert.match(prompt, /screening\.md/);
  assert.match(prompt, /26-08-26_daily Tenders\.xlsx/);
  assert.match(prompt, /Do not open Tender247, send email/);
  assert.match(prompt, /Allowed statuses: DUPLICATE, NO_BID, VERIFY, MAY_BID/);
  assert.match(prompt, /duplicate-rows-manifest\.json/);
  assert.match(prompt, /Run correlation ID: RUN-2026-08-26/);
});

test("dailyScreeningOutputFilename matches operator Excel name", () => {
  assert.equal(
    dailyScreeningOutputFilename("2026-08-27"),
    "27-08-26_daily Tenders.xlsx",
  );
  assert.equal(
    dailyScreeningOutputFilename("2026-08-28"),
    "28-08-26_daily Tenders.xlsx",
  );
});

test("isDailyScreeningOutputFilename accepts browser duplicate suffix (1)", async () => {
  const { isDailyScreeningOutputFilename } = await import(
    "../../chatgptQualification/assistantSpreadsheetAttachment.js"
  );
  const expected = "30-08-26_daily Tenders.xlsx";
  assert.equal(
    isDailyScreeningOutputFilename("30-08-26_daily Tenders(1).xlsx", expected),
    true,
  );
  assert.equal(
    isDailyScreeningOutputFilename("30-08-26_daily Tenders (2).xlsx", expected),
    true,
  );
  assert.equal(
    isDailyScreeningOutputFilename("29-08-26_daily Tenders(1).xlsx", expected),
    false,
  );
});

test("parseDailyScreeningFilenameToIso and before-run-date checks", async () => {
  const {
    parseDailyScreeningFilenameToIso,
    isDailyScreeningFilenameBeforeRunDate,
  } = await import("../buildDailyScreeningOperatorPrompt.js");
  assert.equal(
    parseDailyScreeningFilenameToIso("27-08-26_daily Tenders.xlsx"),
    "2026-08-27",
  );
  assert.equal(
    parseDailyScreeningFilenameToIso("26-08-26_daily Tenders.xlsx"),
    "2026-08-26",
  );
  assert.equal(parseDailyScreeningFilenameToIso("run-screened-siyana.xlsx"), null);
  assert.equal(
    isDailyScreeningFilenameBeforeRunDate(
      "26-08-26_daily Tenders.xlsx",
      "2026-08-27",
    ),
    true,
  );
  assert.equal(
    isDailyScreeningFilenameBeforeRunDate(
      "27-08-26_daily Tenders.xlsx",
      "2026-08-27",
    ),
    false,
  );
  assert.equal(
    isDailyScreeningFilenameBeforeRunDate(
      "28-08-26_daily Tenders.xlsx",
      "2026-08-27",
    ),
    false,
  );
});

test("screening chat URL accepts /c/, /g/.../c/, and share links", () => {
  assert.equal(isScreeningChatUrl(DEFAULT_SIYANA_SCREENING_CHAT_URL), true);
  assert.match(DEFAULT_SIYANA_SCREENING_CHAT_URL, /\/c\//);
  assert.equal(
    isScreeningChatUrl(
      "https://chatgpt.com/c/6a8ff933-78e8-83e8-bbdc-9e448ab4c175",
    ),
    true,
  );
  assert.equal(
    isScreeningChatUrl("https://chatgpt.com/share/6a8ff933-78e8-83e8-bbdc-9e448ab4c175"),
    true,
  );
  assert.equal(isScreeningChatUrl("https://example.com/share/x"), false);
  assert.equal(
    isScreeningChatUrl(
      "https://chatgpt.com/g/g-p-6a6af1fde80c8191a7b497acfa2e0755/project",
    ),
    false,
  );
});

test("resolveScreeningChatUrl defaults to Siyana daily chat", () => {
  assert.equal(
    resolveScreeningChatUrl({ chatgptScreeningChatUrl: null }, {}),
    DEFAULT_SIYANA_SCREENING_CHAT_URL,
  );
  assert.equal(
    resolveScreeningChatUrl(
      {
        chatgptScreeningChatUrl:
          "https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
      {},
    ),
    "https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
});

test("writeScreeningMdPreferences writes company rules file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screening-md-"));
  const out = path.join(dir, "screening.md");
  const snapshot: CompanyPreferenceSnapshot = {
    company: {
      id: "c1",
      name: "Siyana Infosoluctions Private Limited",
      industryType: null,
      businessLocation: null,
      website: null,
      yearEstablished: null,
      description: null,
      slug: null,
    },
    preferences: {
      companyId: "c1",
      maxEmdInr: 1_500_000,
      minTenderValueInr: null,
      maxTenderValueInr: 50_000_000,
      serviceScope: ["custom software", "web portals"],
      excludedScope: ["pure hardware"],
      extras: {},
      updatedAt: null,
    },
    loadedAt: new Date().toISOString(),
  };
  writeScreeningMdPreferences({ snapshot, outputPath: out });
  const text = fs.readFileSync(out, "utf8");
  assert.match(text, /Siyana Tender247 Daily Screening Preferences/);
  assert.match(text, /Hard filters/);
  assert.match(text, /INR 15 lakh/);
  assert.match(text, /DUPLICATE/);
  assert.match(text, /Non-GeM Tenders/);
});
