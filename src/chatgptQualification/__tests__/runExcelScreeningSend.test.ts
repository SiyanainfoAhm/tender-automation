/**
 * Mode-aware ChatGPT pre-send validation:
 * run Excel screening vs single-tender qualification.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { AutomationError } from "../../browserUtils.js";
import { Logger } from "../../logger.js";
import { sendComposerMessage } from "../chatInteraction.js";
import { waitForReturnedWorkbook } from "../../runScreening/chatgptExcelScreening.js";
import {
  assertRunExcelScreeningPreSend,
  assertTenderQualificationPreSend,
  evaluateRunExcelScreeningPreSend,
  evaluateTenderQualificationPreSend,
} from "../chatgptSubmissionKind.js";
import { resetSharedChatGptSubmissionSchedulerForTests } from "../../concurrency/chatGptSubmissionScheduler.js";

const XLSX_ONLY = {
  metadataAttached: false,
  documentsAttached: false,
  aiSummaryAttached: false,
  visibleCardCount: 1,
  candidates: ["run-normalized.xlsx"],
};

const TENDER_COMPLETE = {
  metadataAttached: true,
  documentsAttached: true,
  aiSummaryAttached: true,
  visibleCardCount: 3,
  candidates: ["metadata.json", "AI_Summary.pdf", "Tender_All_Documents.zip"],
};

describe("ChatGPT submissionKind pre-send validators", () => {
  it("RUN_EXCEL_SCREENING accepts workbook-only and does not require metadata/documents", () => {
    const result = evaluateRunExcelScreeningPreSend({
      presence: XLSX_ONLY,
      expectedWorkbookName: "run-normalized.xlsx",
      promptPresent: true,
      sendEnabled: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.workbookReady, true);
    assert.doesNotThrow(() =>
      assertRunExcelScreeningPreSend({
        presence: XLSX_ONLY,
        expectedWorkbookName: "run-normalized.xlsx",
        promptPresent: true,
        sendEnabled: true,
      }),
    );
  });

  it("TENDER_QUALIFICATION still rejects missing metadata and documents", () => {
    const result = evaluateTenderQualificationPreSend(XLSX_ONLY, false);
    assert.equal(result.ok, false);
    assert.equal(result.metadataDetected, false);
    assert.equal(result.documentsDetected, false);
    assert.throws(
      () => assertTenderQualificationPreSend(XLSX_ONLY, false),
      (error: unknown) => {
        assert.ok(error instanceof AutomationError);
        assert.equal(error.code, "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED");
        assert.match(error.message, /missing=metadata,documents/);
        assert.equal(error.message.includes("run-normalized"), false);
        return true;
      },
    );
    assert.equal(evaluateTenderQualificationPreSend(TENDER_COMPLETE, true).ok, true);
  });
});

describe("RUN_EXCEL_SCREENING sendComposerMessage", () => {
  let browser: Browser;
  const logger = new Logger("./logs", "RunScreeningSendTest");

  before(async () => {
    resetSharedChatGptSubmissionSchedulerForTests();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    resetSharedChatGptSubmissionSchedulerForTests();
  });

  it("clicks Send for workbook-only screening and never asks for metadata/documents", async () => {
    const page: Page = await browser.newPage();
    const logs: string[] = [];
    const capturingLogger = {
      info: (msg: string) => {
        logs.push(msg);
        logger.info(msg);
      },
      warn: (msg: string) => {
        logs.push(msg);
        logger.warn(msg);
      },
      error: (msg: string) => {
        logs.push(msg);
        logger.error(msg);
      },
      debug: (msg: string) => logger.debug(msg),
    };

    const prompt =
      "Evaluate the attached tender Excel for Phase-1 screening. Run correlation ID: RUN-2026-08-18. Keep every input row.";
    await page.route("https://chatgpt.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<!DOCTYPE html>
<html><body>
  <div data-message-author-role="user">${prompt}</div>
  <div id="composer" data-agenttender-composer-token="run-screening"
       style="position:relative;width:640px;height:180px;border:1px solid #ccc">
    <div class="file-card" data-testid="file-card">
      <span>run-normalized.xlsx</span>
      <button aria-label="Remove file: run-normalized.xlsx">×</button>
    </div>
    <div id="prompt-textarea" contenteditable="true" aria-label="New chat in Siyana Tender Qualification Automation">${prompt}</div>
    <button data-testid="send-button" aria-label="Send prompt">Send</button>
  </div>
</body></html>`,
      });
    });
    await page.goto("https://chatgpt.com/c/run-screening-test", {
      waitUntil: "domcontentloaded",
    });

    const result = await sendComposerMessage(page, capturingLogger as unknown as Logger, {
      requireNewConversation: true,
      submissionKind: "RUN_EXCEL_SCREENING",
      userMessagePattern:
        /Evaluate the attached tender Excel for Phase-1 screening/i,
      expectedT247Id: "RUN-2026-08-18",
      minAttachmentCount: 1,
      sendSlotAlreadyHeld: true,
      confirmedAttachments: {
        requiredAttachmentsConfirmed: true,
        sourcePortal: "TENDER247",
        sourceTenderId: "RUN-2026-08-18",
        fileNames: ["run-normalized.xlsx"],
        composerIdentity: "run-screening",
      },
    });

    assert.equal(result.submissionConfirmed, true);
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_REQUIRED_ATTACHMENT_MISSING=metadata")),
      false,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_REQUIRED_ATTACHMENT_MISSING=documents")),
      false,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_RUN_SCREENING_WORKBOOK_READY=true")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_SEND_CLICKED")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_MESSAGE_SUBMITTED=true")),
      true,
    );
    await page.close();
  });

  it("sends immediately even when a tender min-interval wait is still outstanding", async () => {
    const prevCwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "run-screen-sched-"));
    const page: Page = await browser.newPage();
    const logs: string[] = [];
    const capturingLogger = {
      info: (msg: string) => {
        logs.push(msg);
        logger.info(msg);
      },
      warn: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
      debug: (msg: string) => logger.debug(msg),
    };
    const prompt =
      "Evaluate the attached tender Excel for Phase-1 screening. Run correlation ID: RUN-2026-08-18. Keep every input row.";
    try {
      process.chdir(tmp);
      fs.mkdirSync(path.join(tmp, "runtime"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "runtime", "chatgpt-last-submission.json"),
        JSON.stringify({
          lastSubmissionAt: new Date().toISOString(),
          sourcePortal: "TENDER247",
          sourceTenderId: "101279958",
        }),
      );
      resetSharedChatGptSubmissionSchedulerForTests();

      await page.route("https://chatgpt.com/**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: `<!DOCTYPE html>
<html><body>
  <div data-message-author-role="user">${prompt}</div>
  <div id="composer" data-agenttender-composer-token="run-screening"
       style="position:relative;width:640px;height:180px;border:1px solid #ccc">
    <div class="file-card" data-testid="file-card">
      <span>run-normalized.xlsx</span>
      <button aria-label="Remove file: run-normalized.xlsx">×</button>
    </div>
    <div id="prompt-textarea" contenteditable="true" aria-label="New chat in Siyana Tender Qualification Automation">${prompt}</div>
    <button data-testid="send-button" aria-label="Send prompt">Send</button>
  </div>
</body></html>`,
        });
      });
      await page.goto("https://chatgpt.com/c/run-screening-nowait", {
        waitUntil: "domcontentloaded",
      });

      const started = Date.now();
      const result = await sendComposerMessage(
        page,
        capturingLogger as unknown as Logger,
        {
          requireNewConversation: true,
          submissionKind: "RUN_EXCEL_SCREENING",
          userMessagePattern:
            /Evaluate the attached tender Excel for Phase-1 screening/i,
          expectedT247Id: "RUN-2026-08-18",
          minAttachmentCount: 1,
          confirmedAttachments: {
            requiredAttachmentsConfirmed: true,
            sourcePortal: "TENDER247",
            sourceTenderId: "RUN-2026-08-18",
            fileNames: ["run-normalized.xlsx"],
            composerIdentity: "run-screening",
          },
        },
      );
      const elapsedMs = Date.now() - started;

      assert.equal(result.submissionConfirmed, true);
      assert.ok(
        elapsedMs < 8_000,
        `RUN_EXCEL_SCREENING waited ${elapsedMs}ms; expected no multi-minute tender interval`,
      );
      assert.equal(
        logs.some((line) => line.includes("CHATGPT_SUBMISSION_KIND=RUN_EXCEL_SCREENING")),
        true,
      );
      assert.equal(
        logs.some((line) => line.includes("CHATGPT_ARTIFICIAL_SEND_DELAY_MS=0")),
        true,
      );
      assert.equal(
        logs.some((line) => line.includes("CHATGPT_SEND_BUTTON_ENABLED=true")),
        true,
      );
      assert.equal(
        logs.some((line) => line.includes("CHATGPT_SEND_CLICK_START")),
        true,
      );
      assert.equal(
        logs.some((line) => line.includes("CHATGPT_SEND_CLICKED")),
        true,
      );
      assert.equal(
        logs.some((line) => line.includes("CHATGPT_MESSAGE_SUBMITTED=true")),
        true,
      );
      assert.equal(
        logs.some((line) =>
          /CHATGPT_SCHEDULER_MIN_INTERVAL_WAIT_MS=\d{4,}/.test(line),
        ),
        false,
      );
      assert.equal(
        logs.some((line) => /CHATGPT_GLOBAL_SEND_WAIT_MS=\d{4,}/.test(line)),
        false,
      );
    } finally {
      process.chdir(prevCwd);
      resetSharedChatGptSubmissionSchedulerForTests();
      await page.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("TENDER_QUALIFICATION send still fails closed when metadata/documents are missing", async () => {
    const page: Page = await browser.newPage();
    const logs: string[] = [];
    const capturingLogger = {
      info: (msg: string) => logs.push(msg),
      warn: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
      debug: () => undefined,
    };
    await page.setContent(`<!DOCTYPE html>
<html><body>
  <div id="composer" data-agenttender-composer-token="tender-qual"
       style="width:640px;height:180px">
    <div class="file-card">
      <span>run-normalized.xlsx</span>
      <button aria-label="Remove file: run-normalized.xlsx">×</button>
    </div>
    <div id="prompt-textarea" contenteditable="true" aria-label="New chat in Siyana Tender Qualification Automation">
      Evaluate this tender for Siyana Info Solutions Pvt. Ltd. T247-101279958 extra padding for length.
    </div>
    <button data-testid="send-button" aria-label="Send prompt">Send</button>
  </div>
</body></html>`);

    await assert.rejects(
      () =>
        sendComposerMessage(page, capturingLogger as unknown as Logger, {
          requireNewConversation: true,
          submissionKind: "TENDER_QUALIFICATION",
          expectedT247Id: "101279958",
          sendSlotAlreadyHeld: true,
          confirmedAttachments: {
            requiredAttachmentsConfirmed: true,
            sourcePortal: "TENDER247",
            sourceTenderId: "101279958",
            fileNames: ["metadata.json", "Tender_All_Documents.zip"],
            composerIdentity: "tender-qual",
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof AutomationError);
        assert.equal(error.code, "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED");
        return true;
      },
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_REQUIRED_ATTACHMENT_MISSING=metadata")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_REQUIRED_ATTACHMENT_MISSING=documents")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_SEND_CLICKED")),
      false,
    );
    await page.close();
  });
});

describe("waitForReturnedWorkbook", () => {
  let browser: Browser;
  const logger = new Logger("./logs", "RunScreeningDownloadTest");

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  it("downloads the assistant XLSX and does not use the composer input file", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "screening-dl-"));
    const outputPath = path.join(tmp, "run-screened-siyana.xlsx");
    const screenedBytes = Buffer.concat([
      Buffer.from("PK\x03\x04"),
      Buffer.from("SCREENED-RESULT"),
    ]);
    const html = `<!DOCTYPE html>
<html><body>
  <div data-message-author-role="user">Evaluate the attached tender Excel. RUN-2026-08-18</div>
  <div id="composer">
    <a download="run-normalized.xlsx" href="/run-normalized.xlsx">run-normalized.xlsx</a>
  </div>
  <div data-message-author-role="assistant">
    Here is the screened workbook
    <a download="screened-result.xlsx" href="/screened-result.xlsx">screened-result.xlsx</a>
  </div>
</body></html>`;
    const server = http.createServer((req, res) => {
      if (req.url?.includes("screened-result.xlsx")) {
        res.writeHead(200, {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="screened-result.xlsx"',
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
      warn: (msg: string) => {
        logs.push(msg);
        logger.warn(msg);
      },
      error: (msg: string) => {
        logs.push(msg);
        logger.error(msg);
      },
      debug: (msg: string) => logger.debug(msg),
    };
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: "domcontentloaded",
    });

    const downloaded = await waitForReturnedWorkbook({
      page,
      outputPath,
      timeoutMs: 15_000,
      logger: capturingLogger as unknown as Logger,
      inputFileName: "run-normalized.xlsx",
      assistantCountBefore: 0,
      expectedFilename: "screened-result.xlsx",
    });

    assert.equal(downloaded.outputPath, outputPath);
    assert.equal(downloaded.originalFilename, "screened-result.xlsx");
    assert.equal(fs.existsSync(outputPath), true);
    assert.ok(fs.readFileSync(outputPath).includes("SCREENED-RESULT"));
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_SCREENING_OUTPUT_DETECTED")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("CHATGPT_SCREENING_OUTPUT_DOWNLOADED")),
      true,
    );
    await page.close();
    await context.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("throws SCREENING_OUTPUT_MISSING when the assistant returns text only", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "screening-missing-"));
    const outputPath = path.join(tmp, "run-screened-siyana.xlsx");
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html>
<html><body>
  <div data-message-author-role="user">Evaluate the attached tender Excel. RUN-2026-08-18</div>
  <div id="composer">
    <a download="run-normalized.xlsx" href="/run-normalized.xlsx">run-normalized.xlsx</a>
  </div>
  <div data-message-author-role="assistant">Screening complete. No file attached.</div>
</body></html>`);

    await assert.rejects(
      () =>
        waitForReturnedWorkbook({
          page,
          outputPath,
          timeoutMs: 6_000,
          logger,
          inputFileName: "run-normalized.xlsx",
        }),
      (error: unknown) => {
        assert.ok(error instanceof AutomationError);
        assert.equal(error.code, "SCREENING_OUTPUT_MISSING");
        return true;
      },
    );
    assert.equal(fs.existsSync(outputPath), false);
    await page.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
