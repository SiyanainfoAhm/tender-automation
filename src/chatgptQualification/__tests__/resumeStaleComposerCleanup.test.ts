/**
 * Resume regression: persistent browser restores stale draft attachments.
 * Cleanup must remove attachment cards (not only draft text) before upload.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { clearCurrentComposer } from "../clearCurrentComposer.js";
import {
  countComposerAttachmentCards,
  ensureComposerCleanBeforeUpload,
} from "../chatInteraction.js";
import { Logger } from "../../logger.js";

const STALE_COMPOSER_HTML = `<!DOCTYPE html>
<html>
<body>
  <main>
    <div id="history">
      <div data-message-author-role="user">old metadata.json from history</div>
    </div>

    <div id="composer-shell" data-testid="composer">
      <div id="attachment-row" style="display:flex;gap:8px">
        <div class="file-card" data-file="metadata.json">
          <span>metadata.json</span>
          <button aria-label="Remove file: metadata.json">×</button>
        </div>
        <div class="file-card" data-file="AI_Summary.pdf">
          <span>AI_Summary.pdf</span>
          <button aria-label="Remove file: AI_Summary.pdf">×</button>
        </div>
      </div>

      <div id="editor-row" style="display:flex;align-items:center;gap:8px">
        <button aria-label="Add files">+</button>
        <div id="prompt-textarea" contenteditable="true" aria-label="Message ChatGPT"
             style="min-width:240px;min-height:40px;border:1px solid #ccc">stale draft prompt</div>
        <button aria-label="Start voice mode">mic</button>
        <button data-testid="send-button" aria-label="Send prompt">Send</button>
      </div>
    </div>
  </main>
  <script>
    document.querySelectorAll('button[aria-label*="Remove file"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.file-card');
        if (card) card.remove();
      });
    });
  </script>
</body>
</html>`;

describe("resume stale composer attachment cleanup", () => {
  let browser: Browser;
  let page: Page;
  const logger = new Logger("./logs", "ResumeComposerCleanupTest");

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  it("removes restored metadata.json + AI_Summary.pdf until count=0", async () => {
    page = await browser.newPage();
    await page.setContent(STALE_COMPOSER_HTML);

    const before = await countComposerAttachmentCards(page, {
      aiSummaryRequired: true,
    });
    assert.equal(before.logicalMetadata, true);
    assert.equal(before.logicalAiSummary, true);
    assert.ok(before.logicalAttachmentCount >= 2);

    const result = await clearCurrentComposer(page, { logger });
    assert.equal(result.clean, true);
    assert.equal(result.afterCount, 0);
    assert.ok(result.removedNames.some((n) => /metadata/i.test(n)));
    assert.ok(result.removedNames.some((n) => /AI_Summary/i.test(n)));

    const after = await countComposerAttachmentCards(page);
    assert.equal(after.logicalAttachmentCount, 0);
    assert.equal(after.logicalMetadata, false);
    assert.equal(after.logicalAiSummary, false);
    assert.deepEqual(after.displayedNames, []);

    // Prompt text cleared
    const promptText = await page.locator("#prompt-textarea").innerText();
    assert.equal(promptText.trim(), "");

    await page.close();
  });

  it("ensureComposerCleanBeforeUpload does not fail solely due to stale drafts", async () => {
    page = await browser.newPage();
    await page.setContent(STALE_COMPOSER_HTML);

    // Token on editor only — cleanup must still walk to shell cards.
    await page.locator("#prompt-textarea").evaluate((el) => {
      el.setAttribute("data-agenttender-composer-token", "tok-resume-stale");
    });

    const cleanup = await ensureComposerCleanBeforeUpload(page, logger, {
      composerToken: "tok-resume-stale",
    });
    assert.equal(cleanup.cleared, true);
    assert.ok(cleanup.beforeCount >= 2);

    const after = await countComposerAttachmentCards(page, {
      composerToken: "tok-resume-stale",
    });
    assert.equal(after.logicalAttachmentCount, 0);

    await page.close();
  });

  it("icon-only remove buttons on file cards still clear attachments", async () => {
    page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html>
<html><body>
<div id="composer-shell">
  <div id="attachment-row">
    <div class="file-card">
      <span>metadata.json</span>
      <button class="x"><svg viewBox="0 0 10 10"><path d="M0 0"/></svg></button>
    </div>
    <div class="file-card">
      <span>AI_Summary.pdf</span>
      <button class="x"><svg viewBox="0 0 10 10"><path d="M0 0"/></svg></button>
    </div>
  </div>
  <div id="editor-row">
    <button aria-label="Add files">+</button>
    <div id="prompt-textarea" contenteditable="true" aria-label="Message ChatGPT"></div>
    <button aria-label="Start voice mode">mic</button>
    <button data-testid="send-button" aria-label="Send prompt">Send</button>
  </div>
</div>
<script>
  document.querySelectorAll('button.x').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.file-card')?.remove());
  });
</script>
</body></html>`);

    const result = await clearCurrentComposer(page, { logger });
    assert.equal(result.clean, true);
    assert.equal(result.afterCount, 0);
    await page.close();
  });
});
