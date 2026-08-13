/**
 * Regression: Worker B candidate failure must never close Worker A's page
 * or the shared BrowserContext.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  assertPageOwnedBy,
  assertSharedContextAlive,
  closeOwnedCandidatePage,
  getPageOwnership,
  isBrowserContextAlive,
  markPageProtectedUntilTerminal,
  openOwnedCandidatePage,
  releasePageProtection,
  registerOwnedPage,
} from "../ownedCandidatePage.js";
import { AutomationError } from "../../browserUtils.js";

describe("dual worker page ownership isolation", () => {
  let browser: Browser;
  let context: BrowserContext;
  let anchor: Page;

  before(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    anchor = await context.newPage();
    await anchor.setContent("<html><body>anchor</body></html>");
  });

  after(async () => {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  });

  it("Worker B failure closes only B page; Worker A page + context stay alive", async () => {
    assert.equal(isBrowserContextAlive(context), true);

    const pageA = await openOwnedCandidatePage({
      context,
      workerId: 1,
      sourceTenderId: "TENDER_A",
    });
    await pageA.setContent("<html><body>worker-A waiting response</body></html>");
    markPageProtectedUntilTerminal(pageA);

    const pageB = await openOwnedCandidatePage({
      context,
      workerId: 2,
      sourceTenderId: "TENDER_B",
    });
    await pageB.setContent("<html><body>worker-B pre-send fail</body></html>");

    // Simulate B PRE_SEND_ATTACHMENT_CHECK_FAILED → close B only.
    releasePageProtection(pageB);
    await closeOwnedCandidatePage({
      page: pageB,
      workerId: 2,
      sourceTenderId: "TENDER_B",
      force: true,
    });

    assert.equal(pageB.isClosed(), true);
    assert.equal(pageA.isClosed(), false);
    assert.equal(anchor.isClosed(), false);
    assert.equal(isBrowserContextAlive(context), true);
    assertSharedContextAlive(context);

    // A can still be used (response arrives).
    const text = await pageA.locator("body").innerText();
    assert.match(text, /worker-A/);

    // A finishes → release protection → close A only.
    releasePageProtection(pageA);
    await closeOwnedCandidatePage({
      page: pageA,
      workerId: 1,
      sourceTenderId: "TENDER_A",
      force: true,
    });
    assert.equal(pageA.isClosed(), true);
    assert.equal(anchor.isClosed(), false);
    assert.equal(isBrowserContextAlive(context), true);
  });

  it("refuses closing another worker's page", async () => {
    const pageA = await openOwnedCandidatePage({
      context,
      workerId: 1,
      sourceTenderId: "A2",
    });
    await pageA.setContent("<html><body>A2</body></html>");

    await assert.rejects(
      () =>
        closeOwnedCandidatePage({
          page: pageA,
          workerId: 2,
          sourceTenderId: "A2",
        }),
      (error: unknown) =>
        error instanceof AutomationError &&
        error.code === "CHATGPT_PAGE_OWNERSHIP_MISMATCH",
    );

    assert.equal(pageA.isClosed(), false);

    // Protected page cannot close without release/force
    markPageProtectedUntilTerminal(pageA);
    await assert.rejects(
      () =>
        closeOwnedCandidatePage({
          page: pageA,
          workerId: 1,
          sourceTenderId: "A2",
        }),
      (error: unknown) =>
        error instanceof AutomationError &&
        error.code === "CHATGPT_PAGE_PROTECTED",
    );
    assert.equal(pageA.isClosed(), false);

    releasePageProtection(pageA);
    await closeOwnedCandidatePage({
      page: pageA,
      workerId: 1,
      sourceTenderId: "A2",
    });
    assert.equal(pageA.isClosed(), true);
  });

  it("dead page reference is detectable; next candidate opens a new page", async () => {
    const old = await openOwnedCandidatePage({
      context,
      workerId: 1,
      sourceTenderId: "OLD",
    });
    await closeOwnedCandidatePage({
      page: old,
      workerId: 1,
      sourceTenderId: "OLD",
      force: true,
    });
    assert.equal(old.isClosed(), true);

    // Do not reuse dead page — open fresh.
    assertSharedContextAlive(context);
    const next = await openOwnedCandidatePage({
      context,
      workerId: 1,
      sourceTenderId: "NEW",
    });
    assert.equal(next.isClosed(), false);
    assert.notEqual(next, old);
    const meta = getPageOwnership(next);
    assert.equal(meta?.workerId, 1);
    assert.equal(meta?.sourceTenderId, "NEW");

    await closeOwnedCandidatePage({
      page: next,
      workerId: 1,
      sourceTenderId: "NEW",
      force: true,
    });
  });
});

describe("ownership helpers unit", () => {
  it("register + assert match", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    registerOwnedPage(page, 9, "X");
    assertPageOwnedBy(page, 9, "X");
    assert.throws(() => {
      assertPageOwnedBy(page, 8, "X");
    });
    await page.close();
    await context.close();
    await browser.close();
  });
});
