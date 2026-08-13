/**
 * Response poll must not block for minutes before JSON detection.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { inspectLatestAssistantBounded } from "../immediateResponseInspect.js";
import { waitForAssistantResponse } from "../chatInteraction.js";
import { Logger } from "../../logger.js";

const COMPLETE_JSON = `{
  "t247Id": "103232437",
  "status": "VERIFY",
  "manualReviewRequired": true,
  "confidence": 99
}`;

const PAGE_HTML = `<!DOCTYPE html>
<html><body>
<main>
  <div data-message-author-role="user">Evaluate this tender for Siyana Info Solutions Pvt. Ltd. T247-103232437</div>
  <div data-message-author-role="assistant">
    <div class="markdown"><pre>${COMPLETE_JSON}</pre></div>
  </div>
  <button aria-label="Stop generating">Stop</button>
</main>
<script>
  // Keep history URL shape for isConversationUrl
</script>
</body></html>`;

describe("non-blocking response poll", () => {
  let browser: Browser;
  let page: Page;
  const logger = new Logger("./logs", "ResponsePollNonBlockingTest");

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  it("inspectLatestAssistantBounded returns text within 3s", async () => {
    page = await browser.newPage();
    await page.setContent(PAGE_HTML);
    const started = Date.now();
    const insp = await inspectLatestAssistantBounded(page, 0, 3000);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3000, `inspect took ${elapsed}ms`);
    assert.equal(insp.assistantCount, 1);
    assert.ok(insp.latestText.includes('"status"'));
    assert.ok(insp.textLength > 20);
    await page.close();
  });

  it("waitForAssistantResponse completes quickly with visible JSON + sticky Stop", async () => {
    page = await browser.newPage();
    // Fake /c/ conversation URL for the waiter gate.
    await page.route("**/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: PAGE_HTML,
      });
    });
    await page.goto("https://chatgpt.com/c/fake-conversation-id");
    await page.setContent(PAGE_HTML);

    const started = Date.now();
    const result = await waitForAssistantResponse({
      page,
      timeoutMs: 60_000,
      logger,
      expectedT247Id: "103232437",
      assistantCountBefore: 0,
      stallTimeoutMs: 300_000,
    });
    const elapsed = Date.now() - started;

    assert.equal(result.status, "complete");
    assert.equal(result.reason, "CANONICAL_JSON_STABLE");
    assert.ok(
      elapsed < 15_000,
      `expected complete within ~8–15s, took ${elapsed}ms`,
    );
    assert.ok(result.text.includes("VERIFY"));
    await page.close();
  });
});
