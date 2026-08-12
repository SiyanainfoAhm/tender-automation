/**
 * Send-button resolution + prompt-ready timeout helpers.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { resolveComposerSendButton } from "../chatInteraction.js";
import { getPromptReadyTimeoutMs } from "../uploadQualificationAttachments.js";

describe("ChatGPT Send after PROMPT_READY", () => {
  let browser: Browser;

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  it("getPromptReadyTimeoutMs defaults to 30s", () => {
    assert.equal(getPromptReadyTimeoutMs({}), 30_000);
    assert.equal(
      getPromptReadyTimeoutMs({ CHATGPT_PROMPT_READY_TIMEOUT_MS: "45000" }),
      45_000,
    );
  });

  it("resolves circular upward-arrow Send inside composer (not mic)", async () => {
    const page: Page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html>
<html><body>
  <div id="composer" data-agenttender-composer-token="tok1"
       style="position:relative;width:640px;height:160px;border:1px solid #ccc">
    <div contenteditable="true" style="height:100px;padding:8px">
      Evaluate this tender for Siyana Info Solutions Pvt. Ltd.
    </div>
    <button aria-label="Add files" style="position:absolute;left:8px;bottom:8px;width:36px;height:36px">+</button>
    <button aria-label="Dictate" style="position:absolute;right:56px;bottom:8px;width:36px;height:36px">
      <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="6"/></svg>
    </button>
    <button data-testid="send-button" aria-label="Send message"
            style="position:absolute;right:8px;bottom:8px;width:36px;height:36px;border-radius:999px;background:#000;color:#fff">
      <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    </button>
  </div>
</body></html>`);

    // Mark active composer container heuristic: include a send-button ancestor.
    const diag = await resolveComposerSendButton(page, undefined, {
      composerToken: "tok1",
    });
    assert.equal(diag.found, true);
    assert.equal(diag.visible, true);
    assert.equal(diag.enabled, true);
    assert.ok(diag.count >= 3);
    const testId = await diag.locator!.getAttribute("data-testid");
    assert.equal(testId, "send-button");
    await page.close();
  });

  it("falls back to bottom-right circular SVG send without aria Send text", async () => {
    const page: Page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html>
<html><body>
  <div id="composer" data-agenttender-composer-token="tok2"
       style="position:relative;width:640px;height:160px;border:1px solid #ccc">
    <div contenteditable="true" style="height:100px">prompt text long enough</div>
    <button style="position:absolute;right:8px;bottom:8px;width:40px;height:40px;border-radius:999px">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    </button>
  </div>
  <!-- page-wide decoy -->
  <button data-testid="send-button" style="position:fixed;left:0;top:0">Page Send</button>
</body></html>`);

    const diag = await resolveComposerSendButton(page, undefined, {
      composerToken: "tok2",
    });
    assert.equal(diag.found, true);
    assert.equal(diag.enabled, true);
    // Must be composer-scoped, not the page-wide decoy.
    const box = await diag.locator!.boundingBox();
    assert.ok(box && box.x > 100);
    await page.close();
  });
});
