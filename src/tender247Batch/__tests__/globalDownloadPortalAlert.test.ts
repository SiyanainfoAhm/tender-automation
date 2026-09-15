/**
 * Portal alert during Download All must classify as failure (click ≠ success).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { clickAndSaveDownload } from "../../tenderDetails/downloadHelpers.js";
import type { Logger } from "../../logger.js";

function logger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m: string) => {
      lines.push(m);
    },
    warn: (m: string) => {
      lines.push(`WARN:${m}`);
    },
    error: (m: string) => {
      lines.push(`ERR:${m}`);
    },
  } as Logger & { lines: string[] };
}

describe("Global Download All portal alert", () => {
  let browser: Browser;

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  it("does not treat click as success when portal shows Failed to download file", async () => {
    const t247Id = "104294221";
    const server = await new Promise<{
      origin: string;
      close: () => Promise<void>;
    }>((resolve) => {
      const httpServer = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!doctype html><html><body>
          <h1>Tender Id: ${t247Id}</h1>
          <h2>Tender Documents</h2>
          <a id="download-all" href="#">Download All Documents</a>
          <script>
            document.getElementById('download-all').addEventListener('click', (e) => {
              e.preventDefault();
              alert('Failed to download file. Please try again.');
            });
          </script>
        </body></html>`);
      });
      httpServer.listen(0, "127.0.0.1", () => {
        const addr = httpServer.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve({
          origin: `http://127.0.0.1:${port}`,
          close: () =>
            new Promise((r) => httpServer.close(() => r())),
        });
      });
    });

    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const log = logger();
    await page.goto(
      `${server.origin}/auth/globaltender/${t247Id}/deadbeef-cafe-babe-0001`,
      { waitUntil: "domcontentloaded" },
    );

    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "t247-alert-"));
    const record = await clickAndSaveDownload({
      page,
      context,
      clickTarget: async () => {
        await page.getByText(/Download All Documents/i).click();
      },
      destinationDir: dest,
      preferredBaseName: "Tender_All_Documents",
      timeoutMs: 8_000,
      logger: log,
      kind: "document",
      linkText: "Download All Documents",
      t247Id,
      capturePortalFailures: true,
    });

    assert.equal(record.status, "failed");
    assert.equal(record.failureKind, "PORTAL_ALERT");
    assert.match(record.portalAlert || "", /Failed to download file/i);
    assert.ok(log.lines.some((l) => /DOWNLOAD_ALL_CLICKED/.test(l)));
    assert.ok(log.lines.some((l) => /GLOBAL_DOWNLOAD_CLICKED/.test(l)));
    assert.ok(log.lines.some((l) => /DOWNLOAD_PORTAL_ALERT/.test(l)));
    assert.equal(
      fs.readdirSync(dest).filter((f) => f.endsWith(".zip") || f.endsWith(".pdf"))
        .length,
      0,
      "no file should be saved after portal alert",
    );

    await page.close();
    await context.close();
    await server.close();
  });
});
