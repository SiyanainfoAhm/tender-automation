/**
 * Regression: after COMPOSER_READY, explicit goto/reload must throw.
 * Normal tender: one project navigation, zero reloads.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { AutomationError } from "../../browserUtils.js";
import {
  assertNavigationAllowed,
  chatGptPageGoto,
  chatGptPageReload,
  getProjectNavigationCount,
  getPageReloadCount,
  initTenderPageLifecycle,
  isNavigationAllowed,
  setTenderPageLifecycleState,
  clearTenderPageLifecycle,
} from "../tenderPageNav.js";

describe("tender page navigation — no reload after COMPOSER_READY", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  before(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    await page.setContent("<html><body>tender</body></html>");
  });

  after(async () => {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  });

  it("allows goto only in NEW_PAGE / PROJECT_LOADING", () => {
    assert.equal(isNavigationAllowed("NEW_PAGE"), true);
    assert.equal(isNavigationAllowed("PROJECT_LOADING"), true);
    assert.equal(isNavigationAllowed("COMPOSER_READY"), false);
    assert.equal(isNavigationAllowed("WAITING_FOR_SEND_SLOT"), false);
    assert.equal(isNavigationAllowed("SUBMITTED"), false);
    assert.equal(isNavigationAllowed("WAITING_RESPONSE"), false);
  });

  it("throws CHATGPT_NAVIGATION_FORBIDDEN_AFTER_COMPOSER_READY", async () => {
    clearTenderPageLifecycle(page);
    initTenderPageLifecycle(page, 1, "103238040");
    setTenderPageLifecycleState(page, "PROJECT_LOADING");
    setTenderPageLifecycleState(page, "COMPOSER_READY");

    assert.throws(
      () => assertNavigationAllowed(page, "goto", "test"),
      (err: unknown) =>
        err instanceof AutomationError &&
        err.code === "CHATGPT_NAVIGATION_FORBIDDEN_AFTER_COMPOSER_READY",
    );

    await assert.rejects(
      () =>
        chatGptPageGoto(page, "https://chatgpt.com/g/g-p-test/project", {
          reason: "illegal_after_composer_ready",
        }),
      (err: unknown) =>
        err instanceof AutomationError &&
        err.code === "CHATGPT_NAVIGATION_FORBIDDEN_AFTER_COMPOSER_READY",
    );

    await assert.rejects(
      () =>
        chatGptPageReload(page, {
          reason: "illegal_reload",
        }),
      (err: unknown) =>
        err instanceof AutomationError &&
        (err.code === "CHATGPT_NAVIGATION_FORBIDDEN_AFTER_COMPOSER_READY" ||
          err.code === "CHATGPT_RELOAD_FORBIDDEN"),
    );
  });

  it("allows exactly one project goto then forbids a second on same page", async () => {
    const p = await context.newPage();
    await p.setContent("<html><body>nav</body></html>");
    clearTenderPageLifecycle(p);
    initTenderPageLifecycle(p, 1, "TENDER_A");
    setTenderPageLifecycleState(p, "PROJECT_LOADING");

    // First goto — counts as navigation #1 (may fail network; we only care about counter/guard)
    try {
      await chatGptPageGoto(p, "data:text/html,<html><body>project</body></html>", {
        reason: "openFreshTenderPage_initial",
        timeout: 5_000,
      });
    } catch {
      // data: URLs usually work; ignore rare failures
    }
    assert.equal(getProjectNavigationCount(p), 1);
    assert.equal(getPageReloadCount(p), 0);

    await assert.rejects(
      () =>
        chatGptPageGoto(p, "data:text/html,<html><body>again</body></html>", {
          reason: "illegal_second_goto",
          timeout: 5_000,
        }),
      (err: unknown) =>
        err instanceof AutomationError &&
        err.code === "CHATGPT_PROJECT_NAVIGATION_LOOP",
    );

    await p.close().catch(() => undefined);
  });
});
