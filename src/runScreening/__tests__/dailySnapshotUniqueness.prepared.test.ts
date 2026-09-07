/**
 * PREPARED TESTS — do not run until authorized.
 *
 * Day-1 / Day-2 scraped_date snapshot invariance for Phase-1 persist.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("persistPhase1Results uses same-day + historical duplicate flow", () => {
  const src = fs.readFileSync(
    path.join(root, "src/runScreening/persistPhase1Results.ts"),
    "utf8",
  );
  assert.match(src, /findSameDayTender/);
  assert.match(src, /findHistoricalPriorTender/);
  assert.match(src, /HISTORICAL_DUPLICATE/);
  assert.match(src, /onConflict:\s*"source_portal,source_tender_id,scraped_date"/);
  assert.doesNotMatch(
    src,
    /onConflict:\s*"source_portal,source_tender_id"\s*[,}]/,
  );
  assert.match(src, /Duplicate Tender247 ID – previously seen on/);
  assert.doesNotMatch(src, /alwaysUpdate[\s\S]*"scraped_date"/);
});

test("migration defines composite daily uniqueness", () => {
  const sql = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260907120000_tender_daily_snapshot_uniqueness.sql",
    ),
    "utf8",
  );
  assert.match(sql, /drop constraint if exists agenttender_tenders_source_unique/);
  assert.match(
    sql,
    /unique \(source_portal, source_tender_id, scraped_date\)/,
  );
  assert.match(sql, /drop constraint if exists agenttender_qualification_source_unique/);
  assert.match(sql, /new\.scraped_date := old\.scraped_date/);
});

test("qualification upsert targets tender_id after snapshot uniqueness", () => {
  const src = fs.readFileSync(
    path.join(root, "src/supabase/qualificationResultStore.ts"),
    "utf8",
  );
  assert.match(src, /onConflict:\s*"tender_id"/);
  assert.match(src, /scrapedDate/);
});

/*
 * Manual acceptance scenario (authorize before running against a test project):
 *
 * DAY 1 input A,B,C scraped_date=2026-09-03 → count(D=2026-09-03)=3
 * DAY 2 input B,C,D scraped_date=2026-09-04 →
 *   A|09-03, B|09-03, C|09-03, B|09-04(DUPLICATE), C|09-04(DUPLICATE), D|09-04
 *   count(09-03)=3, count(09-04)=3, total=6
 * DAY 2 duplicate B,B,C,D → still one B|09-04
 */
