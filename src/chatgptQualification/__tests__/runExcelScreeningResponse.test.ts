/**
 * RUN_EXCEL_SCREENING completes when the assistant returns an XLSX card,
 * even if markdown text is empty and no qualification JSON exists.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { waitForAssistantResponse } from "../chatInteraction.js";
import {
  findGeneratedScreeningWorkbook,
  revealDownloadControl,
  scanLatestAssistantSpreadsheet,
} from "../assistantSpreadsheetAttachment.js";
import { waitForReturnedWorkbook } from "../../runScreening/chatgptExcelScreening.js";
import { Logger } from "../../logger.js";

const LIVE_FILE_CARD_HTML = `<!DOCTYPE html>
<html><body>
  <div data-message-author-role="user">Evaluate the attached tender Excel for Phase-1 screening. RUN-2026-08-17</div>
  <div id="composer">
    <span>run-normalized.xlsx</span>
    <button aria-label="Remove file: run-normalized.xlsx">×</button>
  </div>
  <div data-message-author-role="assistant">
    <div class="markdown">Download the completed Phase-1 screened workbook — 67 tender rows preserved</div>
    <div class="file-card">
      <div>run-normalized-screened-RUN-2026-08-17.xlsx</div>
      <div>Spreadsheet</div>
      <button type="button" aria-label="Download file" title="Download file">Download file</button>
    </div>
  </div>
</body></html>`;

describe("RUN_EXCEL_SCREENING response completion", () => {
  let browser: Browser;
  const logger = new Logger("./logs", "RunScreeningResponseTest");

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  it("detects generated workbook from prose link + hidden hover download", async () => {
    const page: Page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html>
<html><head>
<style>
  .dl { display: none; }
  .file-card:hover .dl { display: inline-block; }
</style>
</head><body>
  <form>
    <div data-message-author-role="user">Evaluate the attached tender Excel for Phase-1 screening. RUN-2026-08-17</div>
    <div data-message-author-role="assistant">
      <a href="/files/run-normalized-screened-RUN-2026-08-17.xlsx">
        Download the completed Phase-1 screened workbook
      </a>
      <div class="file-card">
        <div>run-normalized-screened-RUN-2026-08-17.xlsx</div>
        <div>Spreadsheet</div>
        <button type="button" class="dl" aria-label="Download file" title="Download file">Download file</button>
      </div>
    </div>
    <textarea id="prompt-textarea"></textarea>
  </form>
</body></html>`);
    const visibleBefore = await page
      .getByRole("button", { name: /download file/i })
      .isVisible()
      .catch(() => false);
    assert.equal(visibleBefore, false);

    const workbook = await findGeneratedScreeningWorkbook(page, {
      correlationId: "RUN-2026-08-17",
      inputFileName: "run-normalized.xlsx",
      assistantCountBefore: 1,
    });
    assert.ok(
      workbook,
      "detector must find the generated workbook without a visible download icon",
    );
    assert.equal(workbook!.linkFound, true);
    assert.equal(workbook!.filenameFound, true);
    assert.equal(
      workbook!.filename,
      "run-normalized-screened-RUN-2026-08-17.xlsx",
    );

    await workbook!.cardLocator.hover();
    await page.waitForTimeout(300);
    const visibleAfter = await page
      .getByRole("button", { name: /download file/i })
      .isVisible()
      .catch(() => false);
    assert.equal(visibleAfter, true);
    await page.close();
  });

  it("scan finds the live spreadsheet card and Download file button", async () => {
    const page: Page = await browser.newPage();
    await page.setContent(LIVE_FILE_CARD_HTML);
    const scan = await scanLatestAssistantSpreadsheet(page, {
      inputFileName: "run-normalized.xlsx",
      correlationId: "RUN-2026-08-17",
    });
    assert.equal(scan.filename, "run-normalized-screened-RUN-2026-08-17.xlsx");
    assert.equal(scan.downloadButtonFound, true);
    assert.ok(scan.filenameMatchCount >= 1);
    assert.ok(scan.downloadButtonCount >= 1);
    assert.ok(scan.downloadLocator);
    await page.close();
  });

  it("completes on assistant XLSX without JSON or assistant text length", async () => {
    const page: Page = await browser.newPage();
    const logs: string[] = [];
    const capturingLogger = {
      info: (msg: string) => {
        logs.push(msg);
        logger.info(msg);
      },
      warn: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
      debug: () => undefined,
    };
    await page.route("https://chatgpt.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: LIVE_FILE_CARD_HTML,
      });
    });
    await page.goto("https://chatgpt.com/c/run-screening-xlsx", {
      waitUntil: "domcontentloaded",
    });
    await page.setContent(LIVE_FILE_CARD_HTML);

    const started = Date.now();
    const result = await waitForAssistantResponse({
      page,
      timeoutMs: 20_000,
      logger: capturingLogger as unknown as Logger,
      expectedT247Id: "RUN-2026-08-17",
      assistantCountBefore: 0,
      submissionKind: "RUN_EXCEL_SCREENING",
      inputWorkbookFileName: "run-normalized.xlsx",
    });
    const elapsed = Date.now() - started;

    assert.equal(result.status, "complete");
    assert.equal(result.reason, "SCREENING_XLSX");
    assert.equal(
      result.outputFilename,
      "run-normalized-screened-RUN-2026-08-17.xlsx",
    );
    assert.ok(elapsed < 8_000, `screening wait took ${elapsed}ms`);
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_RESPONSE_MODE=RUN_EXCEL_SCREENING")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_JSON_RESPONSE_REQUIRED=false")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_RESPONSE_JSON_CHECK_START")),
      false,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_VALID_JSON_DETECTED=false")),
      false,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_GENERATED_XLSX_FOUND=true")),
      true,
    );
    assert.equal(
      logs.some((line) =>
        line.includes(
          "CHATGPT_GENERATED_XLSX_FILENAME=run-normalized-screened-RUN-2026-08-17.xlsx",
        ),
      ),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_RESPONSE_INSPECT_START")),
      false,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_RESPONSE_TEXT_EXTRACT_START")),
      false,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_RUN_SCREENING_RESPONSE_COMPLETE=true")),
      true,
    );
    await page.close();
  });

  it("terminates polling and downloads via the Download file button", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "screening-live-card-"));
    const outputPath = path.join(tmp, "run-screened-siyana.xlsx");
    const screenedBytes = Buffer.concat([
      Buffer.from("PK\x03\x04"),
      Buffer.from("SCREENED-LIVE-CARD"),
    ]);
    const html = `<!DOCTYPE html>
<html><body>
  <div data-message-author-role="user">Evaluate the attached tender Excel for Phase-1 screening. RUN-2026-08-17</div>
  <div id="composer">
    <span>run-normalized.xlsx</span>
    <button aria-label="Remove file: run-normalized.xlsx">×</button>
  </div>
  <div data-message-author-role="assistant">
    <div class="markdown">Download the completed Phase-1 screened workbook — 67 tender rows preserved</div>
    <div class="file-card">
      <div>run-normalized-screened-RUN-2026-08-17.xlsx</div>
      <div>Spreadsheet</div>
      <button type="button" aria-label="Download file" title="Download file" id="download-file">Download file</button>
    </div>
  </div>
  <script>
    document.getElementById("download-file").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = "/run-normalized-screened-RUN-2026-08-17.xlsx";
      a.download = "run-normalized-screened-RUN-2026-08-17.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  </script>
</body></html>`;
    const server = http.createServer((req, res) => {
      if (req.url?.includes("run-normalized-screened-RUN-2026-08-17.xlsx")) {
        res.writeHead(200, {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition":
            'attachment; filename="run-normalized-screened-RUN-2026-08-17.xlsx"',
          "content-length": screenedBytes.length,
        });
        res.end(screenedBytes);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const logs: string[] = [];
    const capturingLogger = {
      info: (msg: string) => {
        logs.push(msg);
        logger.info(msg);
      },
      warn: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
      debug: () => undefined,
    };
    await page.goto(`http://127.0.0.1:${port}/c/run-screening-xlsx`, {
      waitUntil: "domcontentloaded",
    });

    const started = Date.now();
    const result = await waitForAssistantResponse({
      page,
      timeoutMs: 20_000,
      logger: capturingLogger as unknown as Logger,
      expectedT247Id: "RUN-2026-08-17",
      assistantCountBefore: 0,
      submissionKind: "RUN_EXCEL_SCREENING",
      inputWorkbookFileName: "run-normalized.xlsx",
    });
    assert.equal(result.status, "complete");
    assert.equal(result.reason, "SCREENING_XLSX");
    assert.ok(Date.now() - started < 8_000);

    const downloaded = await waitForReturnedWorkbook({
      page,
      outputPath,
      timeoutMs: 15_000,
      logger: capturingLogger as unknown as Logger,
      inputFileName: "run-normalized.xlsx",
      expectedFilename: result.outputFilename,
      correlationId: "RUN-2026-08-17",
    });
    assert.equal(
      downloaded.originalFilename,
      "run-normalized-screened-RUN-2026-08-17.xlsx",
    );
    assert.ok(fs.readFileSync(outputPath).includes("SCREENED-LIVE-CARD"));
    assert.equal(
      logs.some((line) =>
        line.includes("CHATGPT_SCREENING_OUTPUT_DOWNLOAD_EVENT_RECEIVED=true"),
      ),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_RESPONSE_INSPECT_START")),
      false,
    );

    await page.close();
    await context.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("does not treat the composer input workbook as the screening result", async () => {
    const page: Page = await browser.newPage();
    const logs: string[] = [];
    const capturingLogger = {
      info: (msg: string) => logs.push(msg),
      warn: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
      debug: () => undefined,
    };
    const html = `<!DOCTYPE html>
<html><body>
  <div data-message-author-role="user">Evaluate the attached tender Excel for Phase-1 screening. RUN-2026-08-17</div>
  <div id="composer"><span>run-normalized.xlsx</span></div>
  <div data-message-author-role="assistant">
    <div class="markdown">No spreadsheet attached.</div>
  </div>
</body></html>`;
    await page.route("https://chatgpt.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    });
    await page.goto("https://chatgpt.com/c/run-screening-no-xlsx", {
      waitUntil: "domcontentloaded",
    });
    await page.setContent(html);

    await assert.rejects(
      () =>
        waitForAssistantResponse({
          page,
          timeoutMs: 4_000,
          logger: capturingLogger as unknown as Logger,
          expectedT247Id: "RUN-2026-08-17",
          assistantCountBefore: 0,
          submissionKind: "RUN_EXCEL_SCREENING",
          inputWorkbookFileName: "run-normalized.xlsx",
          stallTimeoutMs: 60_000,
        }),
      /SCREENING_OUTPUT_MISSING/,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_SCREENING_OUTPUT_ATTACHMENT_FOUND=true")),
      false,
    );
    await page.close();
  });

  it("finds the generated XLSX card when the download control is hidden until hover", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "screening-hover-"));
    const outputPath = path.join(tmp, "run-screened-siyana.xlsx");
    const screenedBytes = Buffer.concat([
      Buffer.from("PK\x03\x04"),
      Buffer.from("HOVER-ONLY-XLSX"),
    ]);
    const html = `<!DOCTYPE html>
<html><head>
<style>
  .dl { display: none; }
  .file-card:hover .dl { display: inline-block; }
</style>
</head><body>
  <div data-message-author-role="user">Evaluate the attached tender Excel for Phase-1 screening. RUN-2026-08-17</div>
  <div id="composer"><span>run-normalized.xlsx</span></div>
  <div data-message-author-role="assistant">
    <div class="file-card">
      <div>run-normalized-screened-RUN-2026-08-17.xlsx</div>
      <div>Spreadsheet</div>
      <button type="button" class="dl" aria-label="Download file" title="Download file" id="download-file">Download file</button>
    </div>
  </div>
  <script>
    document.getElementById("download-file").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = "/run-normalized-screened-RUN-2026-08-17.xlsx";
      a.download = "run-normalized-screened-RUN-2026-08-17.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  </script>
</body></html>`;
    const server = http.createServer((req, res) => {
      if (req.url?.includes(".xlsx")) {
        res.writeHead(200, {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition":
            'attachment; filename="run-normalized-screened-RUN-2026-08-17.xlsx"',
          "content-length": screenedBytes.length,
        });
        res.end(screenedBytes);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/c/run-screening-hover`, {
      waitUntil: "domcontentloaded",
    });

    const workbook = await findGeneratedScreeningWorkbook(page, {
      correlationId: "RUN-2026-08-17",
      inputFileName: "run-normalized.xlsx",
      assistantCountBefore: 0,
    });
    assert.ok(workbook);
    assert.equal(
      workbook!.filename,
      "run-normalized-screened-RUN-2026-08-17.xlsx",
    );
    const visibleBeforeHover = await page
      .getByRole("button", { name: /download file/i })
      .isVisible()
      .catch(() => false);
    assert.equal(visibleBeforeHover, false);

    const control = await revealDownloadControl(page, workbook!);
    assert.ok(control);

    const logs: string[] = [];
    const capturingLogger = {
      info: (msg: string) => logs.push(msg),
      warn: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
      debug: () => undefined,
    };
    const downloaded = await waitForReturnedWorkbook({
      page,
      outputPath,
      timeoutMs: 15_000,
      logger: capturingLogger as unknown as Logger,
      inputFileName: "run-normalized.xlsx",
      correlationId: "RUN-2026-08-17",
    });
    assert.equal(
      downloaded.originalFilename,
      "run-normalized-screened-RUN-2026-08-17.xlsx",
    );
    assert.ok(fs.readFileSync(outputPath).includes("HOVER-ONLY-XLSX"));
    assert.equal(
      logs.some((line) =>
        line.includes("CHATGPT_SCREENING_OUTPUT_DOWNLOAD_EVENT_RECEIVED=true"),
      ),
      true,
    );

    await page.close();
    await context.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("downloads the generated XLSX from the spreadsheet preview toolbar, not the file card", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "screening-preview-"));
    const outputPath = path.join(tmp, "run-screened-siyana.xlsx");
    const screenedBytes = Buffer.concat([
      Buffer.from("PK\x03\x04"),
      Buffer.from("PREVIEW-TOOLBAR-XLSX"),
    ]);
    const filename = "run-screened-siyana-phase1-v3.xlsx";
    const html = `<!DOCTYPE html>
<html><body>
  <div data-message-author-role="user">Evaluate the attached tender Excel for Phase-1 screening. RUN-2026-08-17</div>
  <div id="composer"><span>run-normalized.xlsx</span></div>
  <div data-message-author-role="assistant">
    <div class="file-card" id="xlsx-card">
      <div id="xlsx-name">${filename}</div>
      <div>Spreadsheet</div>
    </div>
  </div>
  <div id="preview" role="dialog" hidden style="position:fixed;right:0;top:0;width:360px;">
    <div>${filename}</div>
    <div role="toolbar">
      <button type="button" aria-label="Download" id="preview-download">Download</button>
    </div>
    <div role="grid">sheet</div>
  </div>
  <a id="library" href="https://chatgpt.com/library">Library</a>
  <script>
    document.getElementById("xlsx-card").addEventListener("click", () => {
      document.getElementById("preview").hidden = false;
    });
    document.getElementById("xlsx-name").addEventListener("click", () => {
      document.getElementById("preview").hidden = false;
    });
    document.getElementById("preview-download").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = "/${filename}";
      a.download = "${filename}";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  </script>
</body></html>`;
    const server = http.createServer((req, res) => {
      if (req.url?.includes(".xlsx")) {
        res.writeHead(200, {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${filename}"`,
          "content-length": screenedBytes.length,
        });
        res.end(screenedBytes);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const logs: string[] = [];
    const capturingLogger = {
      info: (msg: string) => logs.push(msg),
      warn: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
      debug: () => undefined,
    };
    await page.goto(`http://127.0.0.1:${port}/c/run-screening-preview`, {
      waitUntil: "domcontentloaded",
    });

    const downloaded = await waitForReturnedWorkbook({
      page,
      outputPath,
      timeoutMs: 15_000,
      logger: capturingLogger as unknown as Logger,
      inputFileName: "run-normalized.xlsx",
      correlationId: "RUN-2026-08-17",
    });
    assert.equal(downloaded.originalFilename, filename);
    assert.ok(fs.readFileSync(outputPath).includes("PREVIEW-TOOLBAR-XLSX"));
    assert.ok(fs.statSync(outputPath).size > 0);
    for (const line of [
      "CHATGPT_XLSX_CARD_CLICKED=true",
      "CHATGPT_XLSX_PREVIEW_OPENED=true",
      "CHATGPT_XLSX_PREVIEW_DOWNLOAD_BUTTON_FOUND=true",
      "CHATGPT_XLSX_PREVIEW_DOWNLOAD_CLICKED=true",
      "CHATGPT_XLSX_DOWNLOAD_EVENT_RECEIVED=true",
      "CHATGPT_XLSX_LOCAL_FILE_VERIFIED=true",
      "AI_SCREENING_GENERATION_STATUS=SUCCESS",
      "AI_SCREENING_DOWNLOAD_STATUS=SUCCESS",
      "AI_SCREENING_STATUS=SUCCESS",
    ]) {
      assert.equal(logs.some((entry) => entry.includes(line)), true, line);
    }
    assert.equal(
      logs.some((entry) => entry.includes("CHATGPT_SCREENING_LIBRARY_FALLBACK_START")),
      false,
    );

    await page.close();
    await context.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("identifies a generated file link even when no download icon exists", async () => {
    const page: Page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html>
<html><body>
  <div data-message-author-role="user">Evaluate RUN-2026-08-17</div>
  <div id="composer"><span>run-normalized.xlsx</span></div>
  <div data-message-author-role="assistant">
    <a download="run-normalized-screened-RUN-2026-08-17.xlsx" href="/files/run-normalized-screened-RUN-2026-08-17.xlsx">
      run-normalized-screened-RUN-2026-08-17.xlsx
    </a>
  </div>
</body></html>`);
    const workbook = await findGeneratedScreeningWorkbook(page, {
      correlationId: "RUN-2026-08-17",
      inputFileName: "run-normalized.xlsx",
    });
    assert.ok(workbook);
    assert.equal(
      workbook!.filename,
      "run-normalized-screened-RUN-2026-08-17.xlsx",
    );
    const visibleDownload = await page
      .getByRole("button", { name: /download file/i })
      .count()
      .catch(() => 0);
    assert.equal(visibleDownload, 0);
    await page.close();
  });

  it("keeps waiting while generation is idle until the XLSX card appears", async () => {
    const delayMs = Number.parseInt(
      process.env.SCREENING_TEST_XLSX_DELAY_MS || "6000",
      10,
    );
    const html = `<!DOCTYPE html>
<html><body>
  <div data-message-author-role="user">Evaluate the attached tender Excel for Phase-1 screening. RUN-2026-08-17</div>
  <div id="composer"><span>run-normalized.xlsx</span></div>
  <div data-message-author-role="assistant" id="assistant">Working…</div>
  <script>
    setTimeout(() => {
      const el = document.getElementById("assistant");
      el.innerHTML = '<div class="file-card"><div>run-normalized-screened-RUN-2026-08-17.xlsx</div><div>Spreadsheet</div><button type="button" aria-label="Download file">Download file</button></div>';
    }, ${delayMs});
  </script>
</body></html>`;
    const page: Page = await browser.newPage();
    await page.route("https://chatgpt.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    });
    await page.goto("https://chatgpt.com/c/run-screening-delayed", {
      waitUntil: "domcontentloaded",
    });
    await page.setContent(html);

    const started = Date.now();
    const checkpoints: number[] = [];
    const timer = setInterval(() => {
      checkpoints.push(Date.now() - started);
      assert.equal(page.isClosed(), false);
    }, Math.min(2_000, Math.max(1_000, Math.floor(delayMs / 3))));

    try {
      const result = await waitForAssistantResponse({
        page,
        timeoutMs: delayMs + 20_000,
        logger,
        expectedT247Id: "RUN-2026-08-17",
        assistantCountBefore: 0,
        submissionKind: "RUN_EXCEL_SCREENING",
        inputWorkbookFileName: "run-normalized.xlsx",
      });
      const elapsed = Date.now() - started;
      assert.equal(result.status, "complete");
      assert.equal(result.reason, "SCREENING_XLSX");
      assert.ok(
        elapsed >= delayMs,
        `waiter returned too early at ${elapsed}ms before XLSX delay ${delayMs}ms`,
      );
      assert.equal(page.isClosed(), false);
      assert.ok(checkpoints.length >= 1);
    } finally {
      clearInterval(timer);
    }
    await page.close();
  });

  it("detects daily screening workbook with Open file card (Terra UI)", async () => {
    const dailyName = "30-08-26_daily Tenders.xlsx";
    const page: Page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html>
<html><body>
  <article data-testid="conversation-turn-1">
    <div data-message-author-role="user">older prompt</div>
  </article>
  <article data-testid="conversation-turn-2">
    <div data-message-author-role="assistant">older reply</div>
  </article>
  <article data-testid="conversation-turn-3">
    <div data-message-author-role="user">Run Siyana Tender247 Daily Screening RUN-2026-08-30</div>
  </article>
  <article data-testid="conversation-turn-4">
    <div data-message-author-role="assistant">
      <p>This is an exact match to the already screened 30 August workbook.</p>
      <div class="file-card">
        <div>${dailyName}</div>
        <div>Open file</div>
        <button type="button" aria-label="Download">Download</button>
      </div>
    </div>
  </article>
</body></html>`);

    const {
      findDailyWorkbookInAssistantAfterUserMessage,
      findLatestAssistantDailyWorkbook,
    } = await import("../assistantSpreadsheetAttachment.js");

    const latest = await findLatestAssistantDailyWorkbook(page, dailyName);
    assert.ok(latest, "latest assistant turn should expose daily workbook");
    assert.equal(latest!.filename, dailyName);

    const afterUser = await findDailyWorkbookInAssistantAfterUserMessage(page, {
      expectedFilename: dailyName,
      minUserIndex: 1,
    });
    assert.ok(afterUser, "workbook after run user message should be found");
    assert.equal(afterUser!.filename, dailyName);
    await page.close();
  });
});
