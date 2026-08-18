/**
 * Lifecycle: document download must finish before the tender detail page closes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import {
  ensureCanonicalTenderArchive,
  isCanonicalDocumentsZipReady,
  isValidTenderDocumentsZip,
  removeInvalidCanonicalZip,
} from "../canonicalTenderArchive.js";
import {
  clickAndSaveDownload,
  waitForDownloadOnPageOrPopup,
} from "../../tenderDetails/downloadHelpers.js";
import { inspectTenderResumeState } from "../resumeArtifacts.js";
import { writeMinimalValidAiSummaryPdf } from "../tenderArtifactState.js";
import {
  assertCanCloseTenderDetailPage,
  createDocumentStageTracker,
  TenderDocumentStageCloseError,
} from "../tenderDocumentStage.js";
import { downloadRequiredTenderFiles } from "../downloadRequiredTenderFiles.js";
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

function makeZipBytes(): { root: string; documentsDir: string; zipBytes: Buffer } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t247-zip-src-"));
  const documentsDir = path.join(root, "documents");
  fs.mkdirSync(documentsDir, { recursive: true });
  fs.writeFileSync(path.join(documentsDir, "NIT.pdf"), "%PDF-1.4 nit-doc");
  return { root, documentsDir, zipBytes: Buffer.alloc(0) };
}

async function canonicalZipBuffer(): Promise<Buffer> {
  const { root, documentsDir } = makeZipBytes();
  const result = await ensureCanonicalTenderArchive({
    tenderDir: root,
    documentsDir,
    sourceTenderId: "1",
  });
  return fs.readFileSync(result.canonicalZipPath!);
}

function startFixtureServer(options: {
  t247Id: string;
  html: string;
  files: Record<string, { body: Buffer; delayMs?: number; contentType: string; filename: string }>;
}): Promise<{ origin: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || "/";
      const file = options.files[url];
      if (file) {
        const send = (): void => {
          res.writeHead(200, {
            "Content-Type": file.contentType,
            "Content-Disposition": `attachment; filename="${file.filename}"`,
            "Content-Length": String(file.body.length),
          });
          res.end(file.body);
        };
        if (file.delayMs) {
          setTimeout(send, file.delayMs);
        } else {
          send();
        }
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><body>${options.html}</body></html>`);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

describe("Tender247 document stage close guard", () => {
  it("refuses to close while documentStage is downloading", () => {
    const tracker = createDocumentStageTracker("103398321");
    tracker.set("downloading");
    assert.throws(
      () => assertCanCloseTenderDetailPage(tracker, "103398321"),
      TenderDocumentStageCloseError,
    );
    assert.match(
      (() => {
        try {
          assertCanCloseTenderDetailPage(tracker, "103398321");
          return "";
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      })(),
      /REFUSING_TO_CLOSE_TENDER_103398321/,
    );
  });

  it("refuses to close while verifying", () => {
    const tracker = createDocumentStageTracker("103398321");
    tracker.set("verifying");
    assert.throws(() => assertCanCloseTenderDetailPage(tracker));
  });

  it("allows close after success/unavailable/failed", () => {
    const tracker = createDocumentStageTracker("103398321");
    for (const stage of ["success", "unavailable", "failed", "not_started"] as const) {
      tracker.set(stage);
      assert.doesNotThrow(() => assertCanCloseTenderDetailPage(tracker, "103398321"));
    }
  });
});

describe("Tender247 delayed Download All waits for Playwright download", () => {
  let browser: Browser;

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  it("keeps the page open until a delayed ZIP download is saved (Test 1)", async () => {
    const zipBytes = await canonicalZipBuffer();
    const delayMs = 3_000;
    const t247Id = "103398321";
    const server = await startFixtureServer({
      t247Id,
      html: `<h1>Tender Id: ${t247Id}</h1>
        <h2>Tender Documents</h2>
        <a href="/delayed-all.zip">Download All Documents</a>`,
      files: {
        "/delayed-all.zip": {
          body: zipBytes,
          delayMs,
          contentType: "application/zip",
          filename: "Tender_All_Documents.zip",
        },
      },
    });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const log = logger();
    await page.goto(`${server.origin}/auth/tender/${t247Id}/details`, {
      waitUntil: "domcontentloaded",
    });

    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "t247-dl-"));
    const started = Date.now();
    let closedDuringDownload = false;
    const closeWatcher = setInterval(() => {
      if (page.isClosed() && Date.now() - started < delayMs) {
        closedDuringDownload = true;
      }
    }, 50);

    const record = await clickAndSaveDownload({
      page,
      context,
      clickTarget: async () => {
        await page.getByText(/Download All Documents/i).click();
      },
      destinationDir: dest,
      preferredBaseName: "Tender_All_Documents",
      timeoutMs: 30_000,
      logger: log,
      kind: "document",
      linkText: "Download All Documents",
      t247Id,
    });
    clearInterval(closeWatcher);

    const elapsed = Date.now() - started;
    assert.equal(page.isClosed(), false, "page must stay open until download finishes");
    assert.equal(closedDuringDownload, false);
    assert.ok(elapsed >= delayMs - 200, `must wait for delayed download, elapsed=${elapsed}`);
    assert.equal(record.status, "success", record.error || JSON.stringify(log.lines));
    const clickIdx = log.lines.findIndex((l) => l.includes("DOWNLOAD_ALL_CLICKED"));
    const eventIdx = log.lines.findIndex((l) => l.includes("DOWNLOAD_EVENT_RECEIVED"));
    const saveIdx = log.lines.findIndex((l) => l.includes("DOWNLOAD_SAVE_DONE"));
    assert.ok(clickIdx >= 0 && eventIdx > clickIdx && saveIdx > eventIdx);

    await page.close();
    await context.close();
    await server.close();
  });

  it("waits for a slow Download All through the full document stage (Test 2)", async () => {
    const zipBytes = await canonicalZipBuffer();
    const delayMs = 8_000;
    const t247Id = "103398321";
    const server = await startFixtureServer({
      t247Id,
      html: `<h1>Tender Id: ${t247Id}</h1>
        <section>
          <h2>Tender Documents</h2>
          <a href="/slow-all.zip">Download All Documents</a>
        </section>`,
      files: {
        "/slow-all.zip": {
          body: zipBytes,
          delayMs,
          contentType: "application/zip",
          filename: "Tender_All_Documents.zip",
        },
      },
    });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`${server.origin}/auth/tender/${t247Id}/details`, {
      waitUntil: "domcontentloaded",
    });
    const tenderFolder = fs.mkdtempSync(path.join(os.tmpdir(), "t247-slow-"));
    const started = Date.now();
    let closedEarly = false;
    const closeWatcher = setInterval(() => {
      if (page.isClosed() && Date.now() - started < delayMs) {
        closedEarly = true;
      }
    }, 50);
    const result = await downloadRequiredTenderFiles({
      detailPage: page,
      context,
      tenderFolder,
      t247Id,
      timeoutMs: 30_000,
      maxRetries: 1,
      logger: logger(),
    });
    clearInterval(closeWatcher);
    assert.equal(closedEarly, false);
    assert.equal(page.isClosed(), false);
    assert.ok(Date.now() - started >= delayMs - 200);
    assert.equal(result.canonicalZipReady, true);
    assert.equal(result.downloadAllSuccess, true);
    await page.close();
    await context.close();
    await server.close();
  });

  it("packages a Download All PDF into a real ZIP, never renaming bytes (Test 3)", async () => {
    const delayMs = 2_500;
    const t247Id = "103398321";
    const server = await startFixtureServer({
      t247Id,
      html: `<h1>Tender Id: ${t247Id}</h1>
        <h2>Tender Documents</h2>
        <a href="/slow.pdf">Download All Documents</a>`,
      files: {
        "/slow.pdf": {
          body: Buffer.from("%PDF-1.4 delayed-pdf"),
          delayMs,
          contentType: "application/pdf",
          filename: "documents.pdf",
        },
      },
    });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const log = logger();
    await page.goto(`${server.origin}/auth/tender/${t247Id}/details`, {
      waitUntil: "domcontentloaded",
    });
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "t247-pdf-dl-"));
    const started = Date.now();
    const record = await clickAndSaveDownload({
      page,
      context,
      clickTarget: async () => {
        await page.getByText(/Download All Documents/i).click();
      },
      destinationDir: dest,
      preferredBaseName: "Tender_All_Documents",
      timeoutMs: 30_000,
      logger: log,
      kind: "document",
      linkText: "Download All Documents",
      t247Id,
    });

    assert.ok(Date.now() - started >= delayMs - 200, `elapsed too short; ${record.error}`);
    assert.equal(page.isClosed(), false);
    assert.equal(record.status, "success", record.error);
    assert.match(record.finalFilename || "", /\.pdf$/i);
    assert.equal(fs.existsSync(path.join(dest, "_source_download", "documents.pdf")), true);
    const packaged = await ensureCanonicalTenderArchive({
      tenderDir: path.dirname(dest),
      documentsDir: dest,
      sourceTenderId: t247Id,
    });
    assert.equal(packaged.ready, true);
    assert.ok(isValidTenderDocumentsZip(packaged.canonicalZipPath!));
    const zipBytes = fs.readFileSync(packaged.canonicalZipPath!);
    assert.notEqual(zipBytes.subarray(0, 4).toString("ascii"), "%PDF");

    await page.close();
    await context.close();
    await server.close();
  });

  it("still downloads documents when AI Summary is missing (Test 4)", async () => {
    const zipBytes = await canonicalZipBuffer();
    const t247Id = "103383747";
    const server = await startFixtureServer({
      t247Id,
      html: `<h1>Tender Id: ${t247Id}</h1>
        <h2>Tender Documents</h2>
        <a href="/all.zip">Download All Documents</a>`,
      files: {
        "/all.zip": {
          body: zipBytes,
          contentType: "application/zip",
          filename: "Tender_All_Documents.zip",
        },
      },
    });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`${server.origin}/auth/tender/${t247Id}/details`, {
      waitUntil: "domcontentloaded",
    });
    const tenderFolder = fs.mkdtempSync(path.join(os.tmpdir(), "t247-ai-fail-"));
    const result = await downloadRequiredTenderFiles({
      detailPage: page,
      context,
      tenderFolder,
      t247Id,
      timeoutMs: 20_000,
      maxRetries: 1,
      logger: logger(),
    });
    assert.equal(page.isClosed(), false);
    assert.equal(result.canonicalZipReady, true);
    assert.equal(result.aiSummaryDownloaded, false);
    assert.ok(isCanonicalDocumentsZipReady(path.join(tenderFolder, "documents")));
    await page.close();
    await context.close();
    await server.close();
  });

  it("falls back to individual document links when Download All is missing (Test 5)", async () => {
    const t247Id = "103383747";
    const server = await startFixtureServer({
      t247Id,
      html: `<h1>Tender Id: ${t247Id}</h1>
        <section>
          <h2>Tender Documents</h2>
          <a href="/nit.pdf">NIT Download</a>
        </section>`,
      files: {
        "/nit.pdf": {
          body: Buffer.from("%PDF-1.4 nit"),
          contentType: "application/pdf",
          filename: "NIT.pdf",
        },
      },
    });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`${server.origin}/auth/tender/${t247Id}/details`, {
      waitUntil: "domcontentloaded",
    });
    const tenderFolder = fs.mkdtempSync(path.join(os.tmpdir(), "t247-fallback-"));
    const result = await downloadRequiredTenderFiles({
      detailPage: page,
      context,
      tenderFolder,
      t247Id,
      timeoutMs: 20_000,
      maxRetries: 1,
      logger: logger(),
    });
    assert.equal(result.individualFallbackUsed, true, JSON.stringify({
      downloadAllAttempted: result.downloadAllAttempted,
      downloadAllSuccess: result.downloadAllSuccess,
      individualDocsFound: result.individualDocsFound,
      canonicalZipReady: result.canonicalZipReady,
    }));
    assert.equal(result.canonicalZipReady, true);
    assert.equal(page.isClosed(), false);
    await page.close();
    await context.close();
    await server.close();
  });

  it("clicks Download All Documents instead of per-row Download links", async () => {
    const zipBytes = await canonicalZipBuffer();
    const t247Id = "103398321";
    const server = await startFixtureServer({
      t247Id,
      html: `<h1>Tender Id: ${t247Id}</h1>
        <div class="card">
          <div>Tender Documents</div>
          <div>NIT <a href="/nit.pdf">Download</a></div>
          <div>Tender Document 1 <a href="/d1.pdf">Download</a></div>
          <div>Tender Document 2 <a href="/d2.pdf">Download</a></div>
          <div>Tender Document 3 <a href="/d3.pdf">Download</a></div>
          <div>Tender Document 4 <a href="/d4.pdf">Download</a></div>
          <a href="/all.zip"><u>Download All Documents</u></a>
        </div>`,
      files: {
        "/all.zip": {
          body: zipBytes,
          contentType: "application/zip",
          filename: "Tender_All_Documents.zip",
        },
        "/nit.pdf": {
          body: Buffer.from("%PDF-1.4 nit"),
          contentType: "application/pdf",
          filename: "NIT.pdf",
        },
      },
    });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`${server.origin}/auth/tender/${t247Id}/details`, {
      waitUntil: "domcontentloaded",
    });
    const tenderFolder = fs.mkdtempSync(path.join(os.tmpdir(), "t247-all-pref-"));
    const result = await downloadRequiredTenderFiles({
      detailPage: page,
      context,
      tenderFolder,
      t247Id,
      timeoutMs: 20_000,
      maxRetries: 1,
      logger: logger(),
    });
    assert.equal(result.downloadAllSuccess, true, JSON.stringify(result));
    assert.equal(result.individualFallbackUsed, false);
    assert.equal(result.canonicalZipReady, true);
    assert.equal(page.isClosed(), false);
    await page.close();
    await context.close();
    await server.close();
  });
});

describe("Tender247 resume does not skip missing documents ZIP", () => {
  it("reopens when metadata+AI exist but canonical ZIP is missing (Test 6)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t247-resume-"));
    const tenderFolder = path.join(root, "T247-103383747");
    fs.mkdirSync(path.join(tenderFolder, "documents"), { recursive: true });
    fs.writeFileSync(
      path.join(tenderFolder, "metadata.json"),
      JSON.stringify({
        t247Id: "103383747",
        sourceTenderId: "103383747",
        normalized: { tenderName: "x" },
        raw: { a: 1 },
      }),
    );
    writeMinimalValidAiSummaryPdf(path.join(tenderFolder, "AI_Summary.pdf"));
    fs.writeFileSync(path.join(root, "T247-103383747.zip"), "not-a-reason-to-skip");
    const resume = inspectTenderResumeState(root, "103383747");
    assert.equal(resume.metadataValid, true);
    assert.equal(resume.aiSummaryValid, true);
    assert.equal(resume.allDocumentsValid, false);
    assert.equal(resume.finalZipValid, true);
  });

  it("rejects a fake PDF-named-as-zip and removes it (Test 7)", () => {
    const documentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "t247-fake-"));
    const fake = path.join(documentsDir, "Tender_All_Documents.zip");
    fs.writeFileSync(fake, "%PDF-1.4 not-zip");
    assert.equal(isValidTenderDocumentsZip(fake), false);
    removeInvalidCanonicalZip(documentsDir);
    assert.equal(fs.existsSync(fake), false);
  });
});

describe("waitForDownloadOnPageOrPopup registers before click", () => {
  it("exposes the helper used to arm the download listener first", () => {
    assert.equal(typeof waitForDownloadOnPageOrPopup, "function");
  });
});
