import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScreeningNotifyEmail,
  hasWebExcelCountMismatch,
} from "../buildScreeningNotifyEmail.js";
import { sendPowerAutomatePipelineEmail } from "../powerAutomateEmail.js";

const emptyCounts = {
  GO: 2,
  CONDITIONAL_GO: 1,
  PARTNER_BID: 0,
  VERIFY: 3,
  NO_GO: 10,
};

test("mismatch when web Fresh count differs from Excel rows", () => {
  assert.equal(
    hasWebExcelCountMismatch({ webTenderCount: 50, excelRowCount: 48 }),
    true,
  );
  assert.equal(
    hasWebExcelCountMismatch({ webTenderCount: 50, excelRowCount: 50 }),
    false,
  );
  assert.equal(
    hasWebExcelCountMismatch({ webTenderCount: null, excelRowCount: 50 }),
    false,
  );
});

test("compact Fresh badge 1.00 K vs Excel 1003 is not a mismatch", () => {
  assert.equal(
    hasWebExcelCountMismatch({
      webTenderCount: 1000,
      webTenderCountDetails: {
        value: 1000,
        approximate: true,
        min: 996,
        max: 1004,
        token: "1.00 K",
      },
      excelRowCount: 1003,
    }),
    false,
  );
  assert.equal(
    hasWebExcelCountMismatch({
      webTenderCount: 1000,
      webTenderCountDetails: {
        value: 1000,
        approximate: true,
        min: 996,
        max: 1004,
        token: "1.00 K",
      },
      excelRowCount: 980,
    }),
    true,
  );
});

test("success email includes status counts and project numbers", () => {
  const email = buildScreeningNotifyEmail({
    dateIso: "2026-08-26",
    kind: "success",
    webTenderCount: 16,
    excelRowCount: 16,
    screenedRowCount: 16,
    counts: emptyCounts,
    projectNumbers: [
      { status: "GO", ids: ["103544061", "103544074"] },
      { status: "VERIFY", ids: ["103544080"] },
    ],
  });
  assert.match(email.subject, /Screening complete/);
  assert.match(email.subject, /2026-08-26/);
  assert.match(email.body, /Will Bid: 2/);
  assert.match(email.body, /103544061/);
  assert.match(email.body, /Verify/);
});

test("mismatch email subject includes both counts", () => {
  const email = buildScreeningNotifyEmail({
    dateIso: "2026-08-26",
    kind: "mismatch",
    webTenderCount: 20,
    excelRowCount: 18,
    counts: emptyCounts,
  });
  assert.match(email.subject, /COUNT MISMATCH/);
  assert.match(email.subject, /web 20/);
  assert.match(email.subject, /Excel 18/);
  assert.match(email.body, /does not match/);
});

test("failure and no_tenders subjects", () => {
  const fail = buildScreeningNotifyEmail({
    dateIso: "2026-08-26",
    kind: "failure",
    webTenderCount: null,
    excelRowCount: 0,
    counts: {
      GO: 0,
      CONDITIONAL_GO: 0,
      PARTNER_BID: 0,
      VERIFY: 0,
      NO_GO: 0,
    },
    errorMessage: "Uploaded Excel not found",
  });
  assert.match(fail.subject, /FAILED/);
  assert.match(fail.body, /Uploaded Excel not found/);

  const none = buildScreeningNotifyEmail({
    dateIso: "2026-08-26",
    kind: "no_tenders",
    webTenderCount: 0,
    excelRowCount: 0,
    counts: {
      GO: 0,
      CONDITIONAL_GO: 0,
      PARTNER_BID: 0,
      VERIFY: 0,
      NO_GO: 0,
    },
  });
  assert.match(none.subject, /No tenders found/);
});

test("Power Automate posts only subject and body", async () => {
  let posted: unknown = null;
  const result = await sendPowerAutomatePipelineEmail(
    { subject: "Test", body: "<p>Hi</p>" },
    {
      env: {
        POWER_AUTOMATE_EMAIL_ENABLED: "true",
        POWER_AUTOMATE_EMAIL_URL: "https://example.com/webhook",
      } as NodeJS.ProcessEnv,
      fetchImpl: (async (_url, init) => {
        posted = JSON.parse(String(init?.body || "{}"));
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(posted, { subject: "Test", body: "<p>Hi</p>" });
});

test("Power Automate rejects empty dynamic fields", async () => {
  const result = await sendPowerAutomatePipelineEmail(
    { subject: "  ", body: "<p>x</p>" },
    {
      env: {
        POWER_AUTOMATE_EMAIL_ENABLED: "true",
        POWER_AUTOMATE_EMAIL_URL: "https://example.com/webhook",
      } as NodeJS.ProcessEnv,
    },
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error), /subject/i);
});

test("Power Automate skips when URL missing", async () => {
  const result = await sendPowerAutomatePipelineEmail(
    { subject: "Test", body: "x" },
    {
      env: {
        POWER_AUTOMATE_EMAIL_ENABLED: "true",
      } as NodeJS.ProcessEnv,
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
});

test("Power Automate skips when EMAIL_ENABLED is false", async () => {
  let called = false;
  const result = await sendPowerAutomatePipelineEmail(
    { subject: "Test", body: "<p>Hi</p>" },
    {
      env: {
        POWER_AUTOMATE_EMAIL_ENABLED: "false",
        POWER_AUTOMATE_EMAIL_URL: "https://example.com/webhook",
      } as NodeJS.ProcessEnv,
      fetchImpl: (async () => {
        called = true;
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(called, false);
  assert.match(String(result.error), /ENABLED/i);
});
