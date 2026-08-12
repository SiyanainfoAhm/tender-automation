import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDatePropagationAgreement,
  hasBooleanFlag,
  resolveRequestedDate,
} from "../requestedDate.js";
import { getIndiaTodayIsoDate } from "../../dateUtils.js";

test("--date=2026-08-11 equals form", () => {
  const r = resolveRequestedDate(["--date=2026-08-11"], { env: {} });
  assert.equal(r.requestedDate, "2026-08-11");
  assert.equal(r.source, "cli");
});

test("--date 2026-08-11 spaced form", () => {
  const r = resolveRequestedDate(["--date", "2026-08-11"], { env: {} });
  assert.equal(r.requestedDate, "2026-08-11");
  assert.equal(r.source, "cli");
});

test("no date uses Asia/Kolkata today", () => {
  const fixed = new Date("2026-08-12T10:00:00+05:30");
  const r = resolveRequestedDate([], { env: {}, now: fixed });
  assert.equal(r.requestedDate, "2026-08-12");
  assert.equal(r.source, "india_today");
  assert.equal(r.requestedDate, getIndiaTodayIsoDate(fixed));
});

test("invalid explicit date is rejected", () => {
  assert.throws(
    () => resolveRequestedDate(["--date=not-a-date"], { env: {} }),
    /Invalid --date/,
  );
  assert.throws(
    () => resolveRequestedDate(["--date=2026-02-30"], { env: {} }),
    /Invalid --date/,
  );
});

test("npm_config_date fallback when argv empty (Windows PowerShell)", () => {
  const r = resolveRequestedDate([], {
    env: { npm_config_date: "2026-08-11" },
  });
  assert.equal(r.requestedDate, "2026-08-11");
  assert.equal(r.source, "npm_config");
});

test("CLI --date wins over npm_config and env", () => {
  const r = resolveRequestedDate(["--date=2026-08-11"], {
    env: {
      npm_config_date: "2026-08-12",
      TENDER247_DATE: "2026-08-10",
      DATE: "2026-08-09",
    },
  });
  assert.equal(r.requestedDate, "2026-08-11");
  assert.equal(r.source, "cli");
});

test("assertDatePropagationAgreement throws on mismatch", () => {
  assert.throws(
    () =>
      assertDatePropagationAgreement("2026-08-11", {
        E2E_DATE: "2026-08-11",
        TENDER247_RUN_REQUESTED_DATE: "2026-08-12",
      }),
    /DATE_PROPAGATION_MISMATCH/,
  );
});

test("hasBooleanFlag detects dry-run-date via npm_config", () => {
  assert.equal(hasBooleanFlag([], "dry-run-date", {}), false);
  assert.equal(
    hasBooleanFlag(["--dry-run-date"], "dry-run-date", {}),
    true,
  );
  assert.equal(
    hasBooleanFlag([], "dry-run-date", { npm_config_dry_run_date: "true" }),
    true,
  );
});
