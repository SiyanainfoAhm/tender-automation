/**
 * ChatGPT auth detection: login markers vs project title, and closed vs timeout.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { loadConfig } from "../../config.js";
import { resolveProjectPath } from "../../fileUtils.js";
import { Logger } from "../../logger.js";
import {
  CHATGPT_AUTH_BROWSER_CLOSED,
  CHATGPT_AUTH_READY,
  CHATGPT_AUTH_REQUIRED,
  CHATGPT_AUTH_TIMEOUT,
  inspectChatGptAuth,
  isChatGptAuthenticated,
  waitForChatGptAuthentication,
} from "../chatgptAuthState.js";
import {
  buildChatGptPersistentLaunchOptions,
  CHATGPT_PROFILE_DIR,
  CHATGPT_PROFILE_RELATIVE_DIR,
} from "../chatgptProfile.js";

const PROJECT = "Siyana Tender Qualification Automation";

const LOGIN_HTML = `<!DOCTYPE html>
<html>
<body>
  <h1>ChatGPT</h1>
  <p>Get responses tailored to you</p>
  <a href="/auth/login">Log in</a>
  <button>Sign up</button>
  <footer>Siyana Tender Qualification Automation</footer>
</body>
</html>`;

const AUTHENTICATED_SHELL_HTML = `<!DOCTYPE html>
<html>
<body>
  <nav data-testid="sidebar">
    <h2>Projects</h2>
    <a href="/c/abc123">Yesterday's chat</a>
  </nav>
  <button aria-label="Open profile">Profile</button>
  <main>
    <div id="prompt-textarea" contenteditable="true" aria-label="Message ChatGPT"></div>
    <button data-testid="send-button">Send</button>
  </main>
</body>
</html>`;

const AUTHENTICATED_WITH_PROJECT_HTML = `<!DOCTYPE html>
<html>
<body>
  <nav data-testid="sidebar">
    <h2>Projects</h2>
    <a href="/g/g-p-example/project">${PROJECT}</a>
  </nav>
  <header><h1>${PROJECT}</h1></header>
  <button aria-label="Open profile">Profile</button>
  <div id="prompt-textarea" contenteditable="true"></div>
</body>
</html>`;

async function openFixture(page: Page, url: string, html: string): Promise<void> {
  await page.unroute("https://chatgpt.com/**").catch(() => undefined);
  await page.route("https://chatgpt.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: html,
    });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

describe("ChatGPT authentication detection", () => {
  let browser: Browser;
  let page: Page;
  const logger = new Logger("./logs", "ChatGptAuthDetectTest");

  before(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  after(async () => {
    await browser?.close();
  });

  it("uses one canonical persistent profile shared with config", () => {
    const config = loadConfig();
    assert.equal(CHATGPT_PROFILE_DIR, resolveProjectPath("auth", "chatgpt-profile"));
    assert.equal(config.chatgptAuthProfile, CHATGPT_PROFILE_DIR);
    assert.equal(CHATGPT_PROFILE_RELATIVE_DIR, path.join("auth", "chatgpt-profile"));
    const launch = buildChatGptPersistentLaunchOptions();
    assert.equal(launch.headless, false);
    assert.equal(launch.channel, "chrome");
    assert.equal(launch.chromiumSandbox, true);
    assert.equal(launch.acceptDownloads, true);
    assert.equal(launch.viewport, null);
  });

  it("login screen is AUTH_REQUIRED even if project title appears in the page", async () => {
    await openFixture(page, "https://chatgpt.com/auth/login", LOGIN_HTML);
    const inspected = await inspectChatGptAuth(page, PROJECT);
    assert.equal(inspected.state, CHATGPT_AUTH_REQUIRED);
    assert.equal(await isChatGptAuthenticated(page), false);
    assert.equal(inspected.projectAccessible, false);
  });

  it("application shell without project title is AUTH_READY", async () => {
    await openFixture(page, "https://chatgpt.com/", AUTHENTICATED_SHELL_HTML);
    const inspected = await inspectChatGptAuth(page, PROJECT);
    assert.equal(inspected.state, CHATGPT_AUTH_READY);
    assert.equal(await isChatGptAuthenticated(page), true);
    assert.equal(inspected.projectAccessible, false);
    assert.equal(inspected.markers.configuredProjectVisible, false);
  });

  it("project visibility is reported separately from login", async () => {
    await openFixture(page, "https://chatgpt.com/g/g-p-example/project", AUTHENTICATED_WITH_PROJECT_HTML);
    const inspected = await inspectChatGptAuth(page, PROJECT);
    assert.equal(inspected.state, CHATGPT_AUTH_READY);
    assert.equal(inspected.projectAccessible, true);
  });

  it("does not report a 10-minute timeout when the browser was closed", async () => {
    const closedPage = await browser.newPage();
    await closedPage.close();
    const started = Date.now();
    const outcome = await waitForChatGptAuthentication({
      page: closedPage,
      timeoutMs: 600_000,
      logger,
      quiet: true,
    });
    const elapsed = Date.now() - started;
    assert.equal(outcome.status, CHATGPT_AUTH_BROWSER_CLOSED);
    assert.ok(elapsed < 5_000, `closed wait took ${elapsed}ms, expected immediate`);
  });

  it("reports CHATGPT_AUTH_TIMEOUT only after the wait budget elapses", async () => {
    await openFixture(page, "https://chatgpt.com/auth/login", LOGIN_HTML);
    const started = Date.now();
    const outcome = await waitForChatGptAuthentication({
      page,
      timeoutMs: 1_500,
      logger,
      quiet: true,
    });
    const elapsed = Date.now() - started;
    assert.equal(outcome.status, CHATGPT_AUTH_TIMEOUT);
    assert.ok(elapsed >= 1_400, `timeout returned too early (${elapsed}ms)`);
    assert.ok(elapsed < 8_000, `timeout waited too long (${elapsed}ms)`);
  });
});

describe("chatgpt:login command wiring", () => {
  it("npm script and entrypoint share the production profile and do not touch Tender247", () => {
    const pkg = JSON.parse(
      fs.readFileSync(resolveProjectPath("package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.equal(pkg.scripts["chatgpt:login"], "tsx src/chatgptLogin.ts");
    assert.equal(pkg.scripts["auth:chatgpt"], "tsx src/chatgptLogin.ts");

    const loginSrc = fs.readFileSync(resolveProjectPath("src", "chatgptLogin.ts"), "utf8");
    assert.match(loginSrc, /CHATGPT_PROFILE_DIR/);
    assert.match(loginSrc, /launchChatGptPersistentSession/);
    assert.match(loginSrc, /CHATGPT_MANUAL_AUTH_BROWSER_OPEN/);
    assert.equal(loginSrc.includes("runDailyBatch"), false);
    assert.equal(loginSrc.includes("runPhase1ExcelScreening"), false);
    assert.equal(loginSrc.includes("downloadTender247DailyExcel"), false);
    assert.equal(loginSrc.includes("runQualificationBatch"), false);
    assert.equal(loginSrc.includes("crawlTender247"), false);

    const launchSrc = fs.readFileSync(
      resolveProjectPath("src", "chatgptQualification", "ensureChatGptLoggedIn.ts"),
      "utf8",
    );
    assert.match(launchSrc, /CHATGPT_PROFILE_DIR/);
    assert.match(launchSrc, /buildChatGptPersistentLaunchOptions/);
    assert.equal(launchSrc.includes(".chatgpt-browser-profile"), false);
    assert.equal(launchSrc.includes("storageState("), false);
    assert.equal(launchSrc.includes("Deleted untrusted storage state"), false);
  });
});
