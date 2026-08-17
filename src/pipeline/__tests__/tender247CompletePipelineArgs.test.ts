import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTender247CompletePipelineArgs,
} from "../runTender247CompletePipeline.js";

test("complete pipeline parses --date= form", () => {
  const opts = parseTender247CompletePipelineArgs([
    "--date=2026-08-11",
  ]);
  assert.equal(opts.requestedDate, "2026-08-11");
  assert.deepEqual(opts.sources, ["TENDER247"]);
  assert.equal(opts.mode, "complete");
  assert.equal(opts.crawlLimit, null);
  assert.equal(opts.chatgptLimit, null);
});

test("complete mode ignores npm_config_chatgpt_limit test leak", () => {
  const opts = parseTender247CompletePipelineArgs(
    ["--date=2026-08-16", "--resume"],
    { npm_config_chatgpt_limit: "3" },
  );
  assert.equal(opts.mode, "complete");
  assert.equal(opts.chatgptLimit, null);
  assert.equal(opts.resume, true);
});

test("complete pipeline parses --date spaced form", () => {
  const opts = parseTender247CompletePipelineArgs([
    "--date",
    "2026-08-11",
  ]);
  assert.equal(opts.requestedDate, "2026-08-11");
});

test("complete pipeline smoke limits", () => {
  const opts = parseTender247CompletePipelineArgs([
    "--date=2026-08-11",
    "--mode=smoke",
    "--limit=5",
    "--chatgpt-limit=1",
  ]);
  assert.equal(opts.mode, "smoke");
  assert.equal(opts.crawlLimit, 5);
  assert.equal(opts.chatgptLimit, 1);
});

test("complete pipeline dry-run-date flag", () => {
  const opts = parseTender247CompletePipelineArgs([
    "--date=2026-08-11",
    "--dry-run-date",
  ]);
  assert.equal(opts.dryRunDate, true);
});

test("complete pipeline rejects invalid date", () => {
  assert.throws(
    () => parseTender247CompletePipelineArgs(["--date=bad"]),
    /Invalid --date/,
  );
});
