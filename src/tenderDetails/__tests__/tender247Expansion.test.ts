/**
 * Title fallback must fire when no positively identified View/Eye exists.
 * Reminder SVGs and generic right-side icons must never be clicked.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import {
  expandTender247Row,
  expansionTitlesMatch,
} from "../tender247Expansion.js";

const CARD_HTML = `<!DOCTYPE html>
<html>
<body>
<style>
  body { margin: 0; }
</style>
<div id="card" class="border w-full" data-expanded="false"
     style="position:relative;width:1010px;height:136px;border:1px solid #ccc;box-sizing:border-box">
  <div>T247 ID- 103410269</div>
  <p>
    <span id="title-span" class="cursor-pointer">
      Maintaining And Upkeeping Of Scada System Of Bisalpur Dam
    </span>
  </p>
  <button id="reminder-btn" class="cursor-pointer" aria-label="Set Reminder"
          style="position:absolute;right:12px;top:8px;width:40px;height:32px">
    <svg id="reminder-svg-1" width="14" height="14"><circle cx="7" cy="7" r="5"></circle></svg>
    <svg id="reminder-svg-2" width="14" height="14"><rect x="2" y="2" width="10" height="10"></rect></svg>
  </button>
  <button id="bid-btn" class="cursor-pointer" style="position:absolute;right:12px;bottom:8px">Bid</button>
</div>
<script>
  window.clicks = { title: 0, reminder: 0, svg: 0, bid: 0 };
  document.getElementById('title-span').addEventListener('click', (e) => {
    e.stopPropagation();
    window.clicks.title += 1;
    document.getElementById('card').setAttribute('data-expanded', 'true');
  });
  document.getElementById('reminder-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    window.clicks.reminder += 1;
  });
  document.getElementById('bid-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    window.clicks.bid += 1;
  });
  document.querySelectorAll('svg').forEach((svg) => {
    svg.addEventListener('click', (e) => {
      e.stopPropagation();
      window.clicks.svg += 1;
    });
  });
</script>
</body>
</html>`;

describe("Tender247 expansion title fallback", () => {
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

  it("matches the first 50–80 characters of a long title", () => {
    const title =
      "Maintaining And Upkeeping Of Scada System Of Bisalpur Dam extra words here";
    assert.equal(
      expansionTitlesMatch(
        title,
        "Maintaining And Upkeeping Of Scada System Of Bisalpur Dam",
      ),
      true,
    );
  });

  it("clicks title once and never reminder or arbitrary SVGs when no eye exists", async () => {
    logs.length = 0;
    page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 400 });
    await page.setContent(CARD_HTML);

    const row = page.locator("#card");
    const result = await expandTender247Row({
      page,
      row,
      t247Id: "103410269",
      titleHint: "Maintaining And Upkeeping Of Scada System Of Bisalpur Dam",
      logger,
    });

    const clicks = await page.evaluate(
      () =>
        (
          window as unknown as {
            clicks: { title: number; reminder: number; svg: number; bid: number };
          }
        ).clicks,
    );

    assert.equal(result.method, "TITLE");
    assert.equal(clicks.title, 1);
    assert.equal(clicks.reminder, 0);
    assert.equal(clicks.svg, 0);
    assert.equal(clicks.bid, 0);

    const joined = logs.join("\n");
    assert.match(joined, /EXPAND_START/);
    assert.match(joined, /EXPLICIT_VIEW_CONTROL_FOUND=false/);
    assert.match(joined, /TITLE_FALLBACK_START=true/);
    assert.match(joined, /TITLE_CURSOR_SPAN_FOUND=true/);
    assert.match(joined, /TITLE_CLICKED=true/);
    assert.match(joined, /EXPAND_METHOD=TITLE/);
    assert.doesNotMatch(joined, /RIGHT_CURSOR_FALLBACK/);
    assert.doesNotMatch(joined, /using eye SVG directly/i);

    const lowerRightIdx = logs.findIndex((l) =>
      l.includes("TENDER247_LOWER_RIGHT_SVG_CANDIDATES=0"),
    );
    assert.ok(lowerRightIdx >= 0);
    const afterCount = logs.slice(lowerRightIdx + 1).join("\n");
    assert.doesNotMatch(afterCount, /RIGHT_CURSOR_FALLBACK/);
    assert.match(afterCount, /TITLE_FALLBACK_START=true/);

    await page.close();
  });

  it("does not contain right-cursor SVG fallback in production expansion code", () => {
    const src = fs.readFileSync("src/tenderDetails/tender247Expansion.ts", "utf8");
    const openSrc = fs.readFileSync(
      "src/tenderDetails/openSingleTenderDirectly.ts",
      "utf8",
    );
    assert.doesNotMatch(src, /RIGHT_CURSOR_FALLBACK/);
    assert.doesNotMatch(openSrc, /RIGHT_CURSOR_FALLBACK/);
    assert.doesNotMatch(openSrc, /using eye SVG directly/);
    assert.match(src, /p span\.cursor-pointer/);
  });
});
