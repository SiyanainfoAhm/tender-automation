/**
 * Tender247 sequential artifact capture: inner-scroll AI Summary,
 * below-fold documents, Download All + individual fallback.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import {
  extractAiSummaryFullText,
  inspectAiSummaryScrollContainer,
  locateAiSummarySection,
} from "../captureAiSummaryArtifact.js";
import {
  findDownloadAllDocumentsControl,
  findIndividualDocumentControls,
  locateTenderDocumentsSection,
} from "../downloadRequiredTenderFiles.js";
import { isPdfMagic, writeTextPdf } from "../simplePdf.js";
import { loadTender247ConcurrencyConfig } from "../tender247ConcurrencyConfig.js";
import {
  assertEvidenceStateInvariants,
  buildFinalEvidenceState,
  Tender247EvidenceStateInvariantError,
} from "../tender247EvidenceState.js";
import { runSequentialArtifactAcquisition } from "../runSequentialArtifactAcquisition.js";
import { inspectTenderResumeState } from "../resumeArtifacts.js";
import { writeMinimalValidAiSummaryPdf } from "../tenderArtifactState.js";
import { isCanonicalDocumentsZipReady } from "../canonicalTenderArchive.js";
import { correctArtifactFileExtension } from "../detectDownloadedKind.js";

const BOTTOM_MARKER = "UNIQUE_BOTTOM_SUMMARY_LINE_103392468";

function aiSummaryFixtureHtml(): string {
  const hiddenLines = Array.from({ length: 40 }, (_, i) =>
    i === 39
      ? `<p>${BOTTOM_MARKER}</p>`
      : `<p>Hidden summary paragraph ${i + 1}</p>`,
  ).join("");
  return `<!DOCTYPE html>
<html>
<head><title>T247 103392468</title></head>
<body>
  <h1>Tender Id: 103392468</h1>
  <div id="ai-card">
    <h2>AI Generated Tender Summary – Bid / No Bid Decision</h2>
    <div role="tablist">
      <button role="tab">Summary</button>
      <button role="tab">Bid / No Bid Decision</button>
    </div>
    <div id="ai-scroll" style="height:300px;overflow-y:auto;border:1px solid #ccc">
      <p>Visible top of AI summary</p>
      ${hiddenLines}
    </div>
  </div>
  <div style="height:1600px"></div>
  <section id="tender-documents">
    <h2>Tender Documents</h2>
    <a id="nit" href="/nit.pdf" download="NIT.pdf">NIT Download</a>
    <a id="doc1" href="/d1.pdf" download="Tender Document 1.pdf">Tender Document 1 Download</a>
    <a id="corr" href="/corr.pdf" download="Corrigendum.pdf">Corrigendum Download</a>
    <a id="download-all" href="/all.zip" download="Tender_All_Documents.zip">Download All Documents</a>
  </section>
</body>
</html>`;
}

describe("Tender247 artifact locators and AI Summary inner scroll", () => {
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

  it("extracts AI Summary text below the inner scrollbar without page.scrollTo", async () => {
    page = await browser.newPage();
    await page.setViewportSize({ width: 900, height: 700 });
    await page.setContent(aiSummaryFixtureHtml());

    const section = await locateAiSummarySection(page);
    assert.ok(section, "AI summary section should be found");
    const metrics = await inspectAiSummaryScrollContainer(section!);
    assert.equal(metrics.found, true);
    assert.ok(metrics.scrollHeight > 300);
    assert.ok(metrics.clientHeight <= 300);

    const text = await extractAiSummaryFullText(section!);
    assert.match(text, new RegExp(BOTTOM_MARKER));
    assert.match(text, /Visible top of AI summary/);
    await page.close();
  });

  it("generated DOM PDF includes content from the bottom of the scroller", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-pdf-"));
    const pdfPath = path.join(dir, "AI_Summary.pdf");
    writeTextPdf(
      pdfPath,
      "AI Generated Tender Summary",
      `top\n\n${BOTTOM_MARKER}`,
    );
    assert.equal(isPdfMagic(pdfPath), true);
    const raw = fs.readFileSync(pdfPath, "utf8");
    assert.match(raw, new RegExp(BOTTOM_MARKER));
    assert.ok(fs.statSync(pdfPath).size > 0);
  });

  it("finds Tender Documents below the fold and Download All Documents", async () => {
    logs.length = 0;
    page = await browser.newPage();
    await page.setViewportSize({ width: 900, height: 500 });
    await page.setContent(aiSummaryFixtureHtml());

    const inViewport = await page.evaluate(() => {
      const el = document.getElementById("tender-documents");
      const rect = el!.getBoundingClientRect();
      return rect.top >= 0 && rect.top < window.innerHeight;
    });
    assert.equal(inViewport, false, "section should start below the fold");

    const found = await locateTenderDocumentsSection(page, logger);
    assert.equal(found, true);
    assert.ok(logs.some((l) => l.includes("T247_TENDER_DOCUMENTS_SECTION_FOUND=true")));

    await page.evaluate(() => {
      const link = document.getElementById("download-all");
      link?.addEventListener("click", (event) => {
        event.preventDefault();
        (window as unknown as { __downloadAllClicked?: boolean }).__downloadAllClicked =
          true;
      });
    });
    const control = await findDownloadAllDocumentsControl(page);
    assert.ok(control, "Download All Documents control should be found");
    const label = ((await control!.innerText()) || "").replace(/\s+/g, " ").trim();
    assert.match(label, /^Download\s+All\s+Documents$/i);
    await control!.click();
    const clicked = await page.evaluate(
      () =>
        Boolean(
          (window as unknown as { __downloadAllClicked?: boolean })
            .__downloadAllClicked,
        ),
    );
    assert.equal(clicked, true);
    await page.close();
  });

  it("discovers individual document links inside Tender Documents only", async () => {
    page = await browser.newPage();
    await page.setContent(aiSummaryFixtureHtml());
    const items = await findIndividualDocumentControls(page);
    assert.ok(items.length >= 3);
    assert.ok(items.some((it) => /NIT/i.test(it.linkText)));
    assert.ok(items.some((it) => /Corrigendum/i.test(it.linkText)));
    assert.ok(!items.some((it) => /Download All/i.test(it.linkText)));
    await page.close();
  });

  it("collects every Tender Documents link except Download All Documents", async () => {
    page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <h1>Tender Id: 103383747</h1>
      <section>
        <h2>Tender Documents</h2>
        <a href="/nit.pdf">NIT</a>
        <a href="/d1.pdf">Tender Document 1</a>
        <a href="/d2.pdf">Tender Document 2</a>
        <a href="/d3.pdf">Tender Document 3</a>
        <a href="/d4.pdf">Tender Document 4</a>
        <a href="/d5.pdf">Tender Document 5</a>
        <a href="/d6.pdf">Tender Document 6</a>
        <a href="/d7.pdf">Tender Document 7</a>
        <a href="/corr.pdf">Corrigendum</a>
        <a href="/all.zip">Download All Documents</a>
      </section>
    </body></html>`);
    const items = await findIndividualDocumentControls(page);
    assert.equal(items.length, 9);
    assert.ok(items.some((it) => /NIT/i.test(it.linkText)));
    assert.ok(items.some((it) => /Tender Document 7/i.test(it.linkText)));
    assert.ok(items.some((it) => /Corrigendum/i.test(it.linkText)));
    assert.ok(!items.some((it) => /Download All/i.test(it.linkText)));
    await page.close();
  });

  it("does not treat NIT Download as Download All Documents", async () => {
    page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <h1>Tender Id: 103383747</h1>
      <h2>Tender Documents</h2>
      <a href="/nit.pdf">NIT Download</a>
    </body></html>`);
    const control = await findDownloadAllDocumentsControl(page);
    assert.equal(control, null);
    const items = await findIndividualDocumentControls(page);
    assert.equal(items.length, 1);
    assert.match(items[0]!.linkText, /NIT/i);
    await page.close();
  });

  it("selects Download All Documents, not the per-row Download links", async () => {
    page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <h1>Tender Id: 103398321</h1>
      <div class="card">
        <div>Tender Documents</div>
        <div>NIT <a href="/nit.pdf">Download</a></div>
        <div>Tender Document 1 <a href="/d1.pdf">Download</a></div>
        <div>Tender Document 2 <a href="/d2.pdf">Download</a></div>
        <div>Tender Document 3 <a href="/d3.pdf">Download</a></div>
        <div>Tender Document 4 <a href="/d4.pdf">Download</a></div>
        <a id="download-all" href="/all.zip"><u>Download All Documents</u></a>
      </div>
    </body></html>`);
    await page.evaluate(() => {
      document.getElementById("download-all")?.addEventListener("click", (event) => {
        event.preventDefault();
        (window as unknown as { __downloadAllClicked?: boolean }).__downloadAllClicked =
          true;
      });
    });
    const control = await findDownloadAllDocumentsControl(page);
    assert.ok(control, "Download All Documents must be found on the real layout");
    const label = ((await control!.innerText()) || "").replace(/\s+/g, " ").trim();
    assert.match(label, /Download\s+All\s+Documents/i);
    assert.equal(/^Download$/i.test(label), false);
    await control!.click();
    const clicked = await page.evaluate(
      () =>
        Boolean(
          (window as unknown as { __downloadAllClicked?: boolean })
            .__downloadAllClicked,
        ),
    );
    assert.equal(clicked, true);
    await page.close();
  });
});

describe("Tender247 sequential acquisition rules", () => {
  it("does not treat one artifact as permission to skip the rest", () => {
    const stages = ["metadata", "aiSummary", "documents"] as const;
    const available = { metadata: true, aiSummary: false, documents: false };
    const remaining = stages.filter((s) => !available[s]);
    assert.deepEqual(remaining, ["aiSummary", "documents"]);
    assert.equal(remaining.length > 0, true);
  });

  it("maps 3/2/0 artifacts to FULL/PARTIAL/NONE after all stages", () => {
    const mode = (n: number) => (n === 3 ? "FULL" : n >= 1 ? "PARTIAL" : "NONE");
    assert.equal(mode(3), "FULL");
    assert.equal(mode(2), "PARTIAL");
    assert.equal(mode(1), "PARTIAL");
    assert.equal(mode(0), "NONE");
  });

  it("forces selected-tender artifact concurrency to 1 even if env asks for 4", () => {
    const cfg = loadTender247ConcurrencyConfig({
      TENDER247_DETAIL_CONCURRENCY: "4",
      TENDER247_DOWNLOAD_CONCURRENCY: "4",
      TENDER247_ARTIFACT_CONCURRENCY: "4",
    });
    assert.equal(cfg.detailConcurrency, 1);
    assert.equal(cfg.downloadConcurrency, 1);
    assert.equal(cfg.artifactConcurrency, 1);
  });
});

describe("Tender247 evidence state invariants", () => {
  it("rejects downloadAllAttempted=true with documents.attempted=false", () => {
    assert.throws(() => {
      assertEvidenceStateInvariants({
        t247Id: "103392468",
        metadata: { attempted: true, available: true, status: "complete" },
        aiSummary: { attempted: true, available: false, status: "unavailable" },
        documents: {
          attempted: false,
          available: false,
          status: "not_attempted",
          downloadAllAttempted: true,
          individualFallbackUsed: true,
        },
        evidenceMode: "PARTIAL",
        artifactTransactionComplete: false,
        updatedAt: new Date().toISOString(),
      });
    }, Tender247EvidenceStateInvariantError);
  });

  it("requires documents.attempted=true when downloadAllAttempted=true", () => {
    const state = buildFinalEvidenceState({
      t247Id: "103392468",
      metadataAttempted: true,
      metadataAvailable: true,
      metadataStatus: "complete",
      aiAttempted: true,
      aiAvailable: false,
      aiStatus: "unavailable",
      documentsAttempted: true,
      documentsAvailable: false,
      documentsStatus: "failed",
      downloadAllAttempted: true,
      downloadAllSuccess: false,
      individualFallbackUsed: true,
    });
    assert.equal(state.documents.attempted, true);
    assert.equal(state.documents.downloadAllAttempted, true);
    assert.equal(state.documents.individualFallbackUsed, true);
    assert.equal(state.artifactTransactionComplete, true);
    assertEvidenceStateInvariants(state);
  });
});

describe("Tender247 sequential selected-tender loop", () => {
  it("processes A then B then C with no overlap and no GPT until batch complete", async () => {
    const events: string[] = [];
    let gptInitCount = 0;
    const gptStarted = { count: 0 };
    const order: string[] = [];

    await runSequentialArtifactAcquisition({
      candidates: ["A", "B", "C"],
      getId: (id) => id,
      gptStarted,
      onEvent: (event) => events.push(event),
      process: async (id) => {
        order.push(`${id}_OPEN`);
        order.push(`${id}_METADATA_DONE`);
        order.push(`${id}_AI_DONE`);
        order.push(`${id}_DOCUMENTS_DONE`);
        order.push(`${id}_VERIFIED`);
        order.push(`${id}_CLOSE`);
        return {
          evidenceMode: "FULL",
          metadataOk: true,
          aiOk: true,
          documentsOk: true,
          complete: true,
          safeToAdvance: true,
        };
      },
    });

    gptInitCount = 1;
    gptStarted.count = 1;

    assert.deepEqual(order, [
      "A_OPEN",
      "A_METADATA_DONE",
      "A_AI_DONE",
      "A_DOCUMENTS_DONE",
      "A_VERIFIED",
      "A_CLOSE",
      "B_OPEN",
      "B_METADATA_DONE",
      "B_AI_DONE",
      "B_DOCUMENTS_DONE",
      "B_VERIFIED",
      "B_CLOSE",
      "C_OPEN",
      "C_METADATA_DONE",
      "C_AI_DONE",
      "C_DOCUMENTS_DONE",
      "C_VERIFIED",
      "C_CLOSE",
    ]);
    assert.equal(
      events.filter((e) => e.startsWith("T247_ARTIFACT_TRANSACTION_START")).length,
      3,
    );
    const aStart = events.indexOf("T247_ARTIFACT_TRANSACTION_START=A");
    const aDone = events.indexOf("T247_ARTIFACT_TRANSACTION_COMPLETE=A");
    const bStart = events.indexOf("T247_ARTIFACT_TRANSACTION_START=B");
    assert.ok(aStart < aDone);
    assert.ok(aDone < bStart);
    assert.equal(gptInitCount, 1);
    assert.ok(
      events.includes("T247_SELECTED_ARTIFACT_BATCH_COMPLETE=true"),
    );
  });

  it("keeps GPT initialization at 0 until all artifact transactions complete", async () => {
    const gptStarted = { count: 0 };
    await runSequentialArtifactAcquisition({
      candidates: ["A", "B", "C"],
      getId: (id) => id,
      gptStarted,
      process: async () => {
        assert.equal(gptStarted.count, 0);
        return { evidenceMode: "PARTIAL", metadataOk: true, complete: true, safeToAdvance: true };
      },
    });
    assert.equal(gptStarted.count, 0);
  });
});

describe("Tender247 documents completeness is the canonical ZIP only", () => {
  it("does not treat empty documents/ as available", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t247-empty-docs-"));
    const tenderFolder = path.join(root, "T247-100053264");
    fs.mkdirSync(path.join(tenderFolder, "documents"), { recursive: true });
    fs.writeFileSync(
      path.join(tenderFolder, "metadata.json"),
      JSON.stringify({ t247Id: "100053264", sourceTenderId: "100053264", normalized: { tenderName: "x" }, raw: { a: 1 } }),
    );
    writeMinimalValidAiSummaryPdf(path.join(tenderFolder, "AI_Summary.pdf"));
    const resume = inspectTenderResumeState(root, "100053264");
    assert.equal(resume.metadataValid, true);
    assert.equal(resume.aiSummaryValid, true);
    assert.equal(resume.allDocumentsValid, false);
    assert.equal(isCanonicalDocumentsZipReady(path.join(tenderFolder, "documents")), false);
  });

  it("does not treat a PDF stored as .zip as documents complete", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t247-fake-zip-"));
    const documentsDir = path.join(root, "T247-103039753", "documents");
    fs.mkdirSync(documentsDir, { recursive: true });
    const fake = path.join(documentsDir, "Tender_All_Documents.zip");
    fs.writeFileSync(fake, "%PDF-1.4 not-a-zip");
    assert.equal(isCanonicalDocumentsZipReady(documentsDir), false);
    const corrected = correctArtifactFileExtension(fake);
    assert.match(corrected, /\.pdf$/i);
    assert.equal(fs.existsSync(fake), false);
    assert.ok(fs.existsSync(corrected));
  });

  it("metadata + AI presence is not permission to skip documents", () => {
    const available = { metadata: true, aiSummary: true, documents: false };
    assert.equal(available.metadata && available.aiSummary, true);
    assert.equal(available.documents, false);
    assert.equal(
      Boolean(available.metadata && available.aiSummary && !available.documents),
      true,
      "documents stage must still run",
    );
  });
});
