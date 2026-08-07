import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  getArgValue,
  isValidIsoDate,
  parsePrescreenBackfillArgs,
} from "../prescreenBackfillArgs.js";

test("--date=2026-08-06 equals form", () => {
  assert.equal(getArgValue(["--date=2026-08-06"], "date"), "2026-08-06");
  const parsed = parsePrescreenBackfillArgs(["--date=2026-08-06"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.dateIso, "2026-08-06");
    assert.equal(parsed.source, null);
    assert.equal(parsed.sourceLabel, "ALL");
  }
});

test("--date 2026-08-06 spaced form", () => {
  assert.equal(getArgValue(["--date", "2026-08-06"], "date"), "2026-08-06");
  const parsed = parsePrescreenBackfillArgs(["--date", "2026-08-06"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.dateIso, "2026-08-06");
  }
});

test("--source=tender247 equals form", () => {
  const parsed = parsePrescreenBackfillArgs([
    "--date=2026-08-06",
    "--source=tender247",
  ]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.source, "TENDER247");
    assert.equal(parsed.sourceLabel, "TENDER247");
  }
});

test("--source tender247 spaced form", () => {
  const parsed = parsePrescreenBackfillArgs([
    "--date",
    "2026-08-06",
    "--source",
    "tender247",
  ]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.source, "TENDER247");
  }
});

test("--source=bidassist equals form", () => {
  const parsed = parsePrescreenBackfillArgs([
    "--date=2026-08-06",
    "--source=bidassist",
  ]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.source, "BIDASSIST");
    assert.equal(parsed.sourceLabel, "BIDASSIST");
  }
});

test("--source bidassist spaced form", () => {
  const parsed = parsePrescreenBackfillArgs([
    "--date=2026-08-06",
    "--source",
    "bidassist",
  ]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.source, "BIDASSIST");
  }
});

test("date only runs both sources (source=null / ALL)", () => {
  const parsed = parsePrescreenBackfillArgs(["--date=2026-08-06"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.source, null);
    assert.equal(parsed.sourceLabel, "ALL");
  }
});

test("invalid source rejected", () => {
  const parsed = parsePrescreenBackfillArgs([
    "--date=2026-08-06",
    "--source=gem",
  ]);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error, "INVALID_PRESCREEN_SOURCE");
    assert.match(parsed.message, /INVALID_PRESCREEN_SOURCE=gem/);
  }
});

test("missing date prints usage", () => {
  const parsed = parsePrescreenBackfillArgs(["--source=tender247"]);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error, "MISSING_DATE");
    assert.match(parsed.message, /Usage: npm run backfill:prescreen/);
  }
});

test("invalid calendar date rejected", () => {
  assert.equal(isValidIsoDate("2026-02-30"), false);
  const parsed = parsePrescreenBackfillArgs(["--date=2026-02-30"]);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error, "INVALID_DATE");
  }
});

test("--id equals and spaced forms", () => {
  const a = parsePrescreenBackfillArgs([
    "--date=2026-08-06",
    "--id=102800878",
  ]);
  assert.equal(a.ok, true);
  if (a.ok) assert.equal(a.id, "102800878");

  const b = parsePrescreenBackfillArgs([
    "--date=2026-08-06",
    "--id",
    "102800878",
  ]);
  assert.equal(b.ok, true);
  if (b.ok) assert.equal(b.id, "102800878");
});

test("backfill never invokes ChatGPT", () => {
  const src = fs.readFileSync(
    "src/prescreen/prescreenBackfillRunner.ts",
    "utf8",
  );
  assert.match(src, /PRESCREEN_BACKFILL_CHATGPT=never/);
  assert.doesNotMatch(
    src,
    /qualifySingleTender|qualifyBidassistTender|openChatGpt|uploadQualificationAttachments/,
  );
  assert.match(src, /listTendersForPrescreenBackfill/);
  assert.match(src, /persistPrescreenResult/);
});

test("npm_config fallback when PowerShell swallows -- args", () => {
  const parsed = parsePrescreenBackfillArgs([], {
    npm_config_date: "2026-08-06",
    npm_config_source: "tender247",
  } as NodeJS.ProcessEnv);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.dateIso, "2026-08-06");
    assert.equal(parsed.source, "TENDER247");
  }
});

test("argv wins over npm_config", () => {
  const parsed = parsePrescreenBackfillArgs(
    ["--date=2026-08-07", "--source=bidassist"],
    {
      npm_config_date: "2026-08-06",
      npm_config_source: "tender247",
    } as NodeJS.ProcessEnv,
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.dateIso, "2026-08-07");
    assert.equal(parsed.source, "BIDASSIST");
  }
});

test("npm_config boolean true is ignored for valued flags", () => {
  const parsed = parsePrescreenBackfillArgs([], {
    npm_config_date: "true",
  } as NodeJS.ProcessEnv);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error, "MISSING_DATE");
  }
});

test("package.json script key is backfill:prescreen without escapes", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    pkg.scripts["backfill:prescreen"],
    "tsx src/prescreen/backfillPrescreenResults.ts",
  );
  assert.equal(pkg.scripts["backfill\\:prescreen"], undefined);
});
