import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { asiaKolkataDayBounds } from "../prescreenDayBounds.js";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

function runCli(
  args: string[],
  options?: { timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [tsxCli, "src/prescreen/backfillPrescreenResults.ts", ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out: ${args.join(" ")}`));
    }, options?.timeoutMs ?? 60_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("asia/kolkata day bounds use +05:30 not UTC midnight", () => {
  const bounds = asiaKolkataDayBounds("2026-08-06");
  assert.equal(bounds.startUtc, "2026-08-05T18:30:00.000Z");
  assert.equal(bounds.endUtcExclusive, "2026-08-06T18:30:00.000Z");
  assert.equal(bounds.startLocal, "2026-08-06T00:00:00+05:30");
});

test("CLI entry point invokes main and logs startup", async () => {
  const { code, stdout, stderr } = await runCli(["--date=2099-01-01"]);
  const out = `${stdout}\n${stderr}`;
  assert.match(out, /PRESCREEN_BACKFILL_START/);
  assert.match(out, /PRESCREEN_BACKFILL_ARGS=/);
  assert.match(out, /PRESCREEN_BACKFILL_DATE=2099-01-01/);
  assert.match(out, /PRESCREEN_BACKFILL_SOURCE=ALL/);
  assert.match(out, /PRESCREEN_BACKFILL_QUERY_START/);
  assert.match(out, /PRESCREEN_BACKFILL_ROWS_FOUND=/);
  assert.match(out, /Pre-screen Backfill/);
  assert.match(out, /Found:/);
  assert.equal(code, 0);
});

test("CLI zero rows still prints summary", async () => {
  const { code, stdout, stderr } = await runCli(["--date=2099-01-01"]);
  const out = `${stdout}\n${stderr}`;
  assert.match(out, /PRESCREEN_BACKFILL_NO_TENDERS_FOUND|PRESCREEN_BACKFILL_ROWS_FOUND=0/);
  assert.match(out, /Found: 0/);
  assert.match(out, /Passed: 0/);
  assert.match(out, /ChatGPT eligible: 0/);
  assert.equal(code, 0);
});

test("CLI source=tender247 filters correctly", async () => {
  const { code, stdout, stderr } = await runCli([
    "--date=2099-01-01",
    "--source=tender247",
  ]);
  const out = `${stdout}\n${stderr}`;
  assert.match(out, /PRESCREEN_BACKFILL_SOURCE=TENDER247/);
  assert.match(out, /PRESCREEN_BACKFILL_START/);
  assert.equal(code, 0);
});

test("CLI source=bidassist filters correctly", async () => {
  const { code, stdout, stderr } = await runCli([
    "--date",
    "2099-01-01",
    "--source",
    "bidassist",
  ]);
  const out = `${stdout}\n${stderr}`;
  assert.match(out, /PRESCREEN_BACKFILL_SOURCE=BIDASSIST/);
  assert.equal(code, 0);
});

test("CLI missing date prints usage and exits 1", async () => {
  const { code, stdout, stderr } = await runCli([]);
  const out = `${stdout}\n${stderr}`;
  assert.match(out, /PRESCREEN_BACKFILL_START/);
  assert.match(out, /Usage: npm run backfill:prescreen/);
  assert.equal(code, 1);
});

test("CLI never invokes ChatGPT code paths", () => {
  const cli = fs.readFileSync(
    "src/prescreen/backfillPrescreenResults.ts",
    "utf8",
  );
  const runner = fs.readFileSync(
    "src/prescreen/prescreenBackfillRunner.ts",
    "utf8",
  );
  for (const src of [cli, runner]) {
    assert.doesNotMatch(
      src,
      /qualifySingleTender|qualifyBidassistTender|openChatGpt|uploadQualificationAttachments|launchChromium|chromium\.launch/,
    );
  }
  assert.match(runner, /evaluatePrescreen/);
  assert.match(runner, /persistPrescreenResult/);
  assert.match(runner, /listTendersForPrescreenBackfill/);
  assert.match(cli, /void main\(\)\.catch/);
  assert.doesNotMatch(cli, /isDirectRun|require\.main/);
});

test("CLI entry always invokes main without require.main guard", () => {
  const cli = fs.readFileSync(
    path.join("src/prescreen/backfillPrescreenResults.ts"),
    "utf8",
  );
  assert.match(cli, /void main\(\)\.catch/);
  assert.match(cli, /PRESCREEN_BACKFILL_FATAL/);
  assert.match(cli, /console\.log\("PRESCREEN_BACKFILL_START"\)/);
  assert.doesNotMatch(cli, /require\.main|isDirectRun|pathToFileURL|import\.meta\.url ===/);
  // Heavy deps must load after START so START always prints
  assert.match(cli, /await import\("\.\/prescreenBackfillRunner\.js"\)/);
});
