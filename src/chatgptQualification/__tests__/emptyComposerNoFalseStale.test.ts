/**
 * Regression: empty project composer must NOT treat history/Share as attachments.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import {
  discoverComposerAttachments,
} from "../composerShellAttachments.js";
import { clearCurrentComposer } from "../clearCurrentComposer.js";
import { Logger } from "../../logger.js";

const EMPTY_PROJECT_HTML = `<!DOCTYPE html>
<html>
<body>
  <header id="project-header">
    <h1>Siyana Tender Qualification Automation</h1>
    <button id="share-btn" aria-label="Share">Share</button>
    <button id="more-btn" aria-label="Open conversation options">⋯</button>
  </header>
  <aside id="history">
    <div data-message-author-role="user">previous upload mentioned metadata.json</div>
    <div>Sources list: metadata.json from old tender</div>
  </aside>
  <main>
    <div id="composer-shell" data-testid="composer">
      <div id="editor-row" style="display:flex;align-items:center;gap:8px">
        <button aria-label="Add files">+</button>
        <div id="prompt-textarea" contenteditable="true"
             aria-label="New chat in Siyana Tender Qualification Automation"
             style="min-width:240px;min-height:40px;border:1px solid #ccc"></div>
        <button aria-label="Start voice mode">mic</button>
        <button data-testid="send-button" aria-label="Send prompt">Send</button>
      </div>
    </div>
  </main>
  <script>
    window.__shareClicks = 0;
    window.__moreClicks = 0;
    window.__anyRemoveAttempts = 0;
    document.getElementById('share-btn').addEventListener('click', () => { window.__shareClicks += 1; });
    document.getElementById('more-btn').addEventListener('click', () => { window.__moreClicks += 1; });
    document.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const lab = (b.getAttribute('aria-label') || '') + (b.textContent || '');
        if (/remove|delete|share|more|options/i.test(lab) || b.id === 'share-btn' || b.id === 'more-btn') {
          window.__anyRemoveAttempts += 1;
        }
      });
    });
  </script>
</body>
</html>`;

const REAL_CARD_HTML = `<!DOCTYPE html>
<html>
<body>
  <header>
    <button id="share-btn" aria-label="Share">Share</button>
    <button id="more-btn" aria-label="Open conversation options">⋯</button>
  </header>
  <aside id="history">
    <div data-message-author-role="user">old metadata.json</div>
  </aside>
  <main>
    <div id="composer-shell">
      <div id="attachment-row">
        <div class="file-card">
          <span>metadata.json</span>
          <button aria-label="Remove file: metadata.json">×</button>
        </div>
      </div>
      <div id="editor-row">
        <button aria-label="Add files">+</button>
        <div id="prompt-textarea" contenteditable="true" aria-label="Message ChatGPT"></div>
        <button data-testid="send-button" aria-label="Send prompt">Send</button>
      </div>
    </div>
  </main>
  <script>
    window.__shareClicks = 0;
    window.__cardRemoveClicks = 0;
    document.getElementById('share-btn').addEventListener('click', () => { window.__shareClicks += 1; });
    document.querySelector('.file-card button').addEventListener('click', (e) => {
      window.__cardRemoveClicks += 1;
      e.currentTarget.closest('.file-card')?.remove();
    });
  </script>
</body>
</html>`;

describe("empty composer — no false stale attachments / no Share clicks", () => {
  let browser: Browser;
  let page: Page;
  const logger = new Logger("./logs", "EmptyComposerStaleTest");

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  it("empty composer with history metadata.json → count 0, no remove, no Share", async () => {
    page = await browser.newPage();
    await page.setContent(EMPTY_PROJECT_HTML);

    const discovered = await discoverComposerAttachments(page);
    assert.deepEqual(discovered.filenames, []);
    assert.equal(discovered.logicalAttachmentCount, 0);

    const result = await clearCurrentComposer(page, { logger });
    assert.equal(result.clean, true);
    assert.equal(result.afterCount, 0);
    assert.equal(result.removedNames.length, 0);

    const clicks = await page.evaluate(() => ({
      share: (window as unknown as { __shareClicks: number }).__shareClicks,
      more: (window as unknown as { __moreClicks: number }).__moreClicks,
    }));
    assert.equal(clicks.share, 0);
    assert.equal(clicks.more, 0);

    await page.close();
  });

  it("real metadata card remove is card-local; Share never clicked", async () => {
    page = await browser.newPage();
    await page.setContent(REAL_CARD_HTML);

    const before = await discoverComposerAttachments(page);
    assert.equal(before.logicalTypes.metadata, true);
    assert.equal(before.logicalAttachmentCount, 1);

    const result = await clearCurrentComposer(page, { logger });
    assert.equal(result.clean, true);
    assert.equal(result.afterCount, 0);

    const clicks = await page.evaluate(() => ({
      share: (window as unknown as { __shareClicks: number }).__shareClicks,
      card: (window as unknown as { __cardRemoveClicks: number }).__cardRemoveClicks,
    }));
    assert.equal(clicks.share, 0);
    assert.ok(clicks.card >= 1);

    await page.close();
  });
});
