/**
 * Reminder modal dismissal must unblock document actions without killing the pipeline.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { AutomationError } from "../../browserUtils.js";
import {
  dismissTender247Interruptions,
  dismissTender247ReminderModal,
  isReminderModalVisible,
} from "../dismissTender247Interruptions.js";

const DETAIL_HTML = `<!DOCTYPE html>
<html>
<body>
  <h1>Tender Detail</h1>
  <button id="download-docs">Download All Documents</button>
  <div id="result"></div>

  <div id="reminder-modal" role="dialog" aria-modal="true"
       style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999">
    <div id="reminder-panel" style="position:relative;background:#fff;padding:24px 32px;width:420px;min-height:280px">
      <button id="reminder-close" aria-label="Close"
              style="position:absolute;top:8px;right:8px;width:28px;height:28px;border:0;background:transparent;cursor:pointer;font-size:20px">×</button>
      <h2>T247 ID: 103258593 :- Set Reminder</h2>
      <label>Mail Date <input type="date" /></label><br/>
      <label>Enter your email <input type="email" placeholder="email" /></label><br/>
      <label>reminder message <textarea></textarea></label><br/>
      <label>WhatsApp number <input /></label><br/>
      <button id="reminder-submit">Submit</button>
    </div>
  </div>

  <script>
    document.getElementById('reminder-close').addEventListener('click', () => {
      document.getElementById('reminder-modal').remove();
    });
    document.getElementById('download-docs').addEventListener('click', () => {
      const blocked = !!document.getElementById('reminder-modal');
      if (blocked) {
        document.getElementById('result').textContent = 'BLOCKED';
        return;
      }
      document.getElementById('result').textContent = 'DOWNLOADED';
    });
  </script>
</body>
</html>`;

describe("dismissTender247Interruptions — Set Reminder modal", () => {
  let browser: Browser;
  let page: Page;
  const logs: string[] = [];
  const logger = {
    info: (m: string) => logs.push(m),
    warn: (m: string) => logs.push(`WARN:${m}`),
    error: (m: string) => logs.push(`ERR:${m}`),
  };

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  it("is a no-op when modal is absent", async () => {
    page = await browser.newPage();
    await page.setContent("<html><body><h1>ok</h1></body></html>");
    await dismissTender247Interruptions(page, logger);
    assert.equal(await isReminderModalVisible(page), false);
    await page.close();
  });

  it("detects reminder modal, clicks modal-local X, unblocks document action", async () => {
    logs.length = 0;
    page = await browser.newPage();
    await page.setContent(DETAIL_HTML);

    assert.equal(await isReminderModalVisible(page), true);
    // Overlay present — download control remains in DOM but is covered.
    assert.equal(await page.locator("#reminder-modal").isVisible(), true);
    assert.equal(await page.locator("#download-docs").isVisible(), true);

    await dismissTender247ReminderModal(page, logger);

    assert.ok(logs.some((l) => l.includes("TENDER247_REMINDER_MODAL_DETECTED=true")));
    assert.ok(
      logs.some((l) => l.includes("TENDER247_REMINDER_MODAL_TENDER_ID=103258593")),
    );
    assert.ok(logs.some((l) => l.includes("TENDER247_REMINDER_MODAL_DISMISSED=true")));
    assert.equal(await isReminderModalVisible(page), false);
    assert.equal(await page.locator("#reminder-modal").count(), 0);

    // Original document action resumes after dismiss.
    await page.locator("#download-docs").click();
    assert.equal(await page.locator("#result").innerText(), "DOWNLOADED");

    // Submit must never have been clicked (modal gone without form submit).
    assert.equal(await page.locator("#reminder-submit").count(), 0);
    await page.close();
  });

  it("full interruptions helper dismisses reminder then allows download", async () => {
    page = await browser.newPage();
    await page.setContent(DETAIL_HTML);
    assert.equal(await isReminderModalVisible(page), true);

    await dismissTender247Interruptions(page, logger);
    assert.equal(await isReminderModalVisible(page), false);

    await page.locator("#download-docs").click();
    assert.equal(await page.locator("#result").innerText(), "DOWNLOADED");
    await page.close();
  });

  it("throws candidate-level TENDER247_REMINDER_MODAL_BLOCKING when X cannot close", async () => {
    page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html>
<html><body>
  <div role="dialog" aria-modal="true" id="stuck">
    <h2>T247 ID: 999999 :- Set Reminder</h2>
    <label>Mail Date <input /></label>
    <label>Enter your email <input type="email" /></label>
    <button>Submit</button>
    <!-- no working close control -->
  </div>
</body></html>`);

    await assert.rejects(
      () => dismissTender247ReminderModal(page, logger),
      (err: unknown) =>
        err instanceof AutomationError &&
        err.code === "TENDER247_REMINDER_MODAL_BLOCKING",
    );
    await page.close();
  });
});
