/**
 * Regression: attachment cards as SIBLINGS of contenteditable must be discovered.
 * Prevents composerCount=0 when files are visibly present in the composer shell.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import {
  discoverComposerAttachments,
  resolveComposerShell,
} from "../composerShellAttachments.js";
import {
  countComposerAttachmentCards,
  getAttachmentValidationTimeoutMs,
} from "../chatInteraction.js";
import {
  evaluateAttachmentStabilityPoll,
} from "../tender247AttachmentUploadState.js";
import { buildTender247ExpectedManifest } from "../tender247AttachmentManifest.js";
import type { QualificationAttachmentFile } from "../sourceDocumentResolver.js";

const COMPOSER_HTML = `<!DOCTYPE html>
<html>
<body>
  <main>
    <div id="history">
      <div data-message-author-role="user">old metadata.json from history</div>
    </div>

    <div id="composer-shell" data-testid="composer">
      <div id="attachment-row" style="display:flex;gap:8px">
        <div class="file-card">
          <span>metadata(20260812-190914).json</span>
          <button aria-label="Remove file: metadata(20260812-190914).json">×</button>
        </div>
        <div class="file-card">
          <span>AI_Summary(20260812-190914).pdf</span>
          <button aria-label="Remove file: AI_Summary(20260812-190914).pdf">×</button>
        </div>
        <div class="file-card">
          <span>Tender_All_Documents(20260812-190914).zip</span>
          <div>Zip Archive</div>
          <button aria-label="Remove file: Tender_All_Documents(20260812-190914).zip">×</button>
        </div>
      </div>

      <div id="editor-row" style="display:flex;align-items:center;gap:8px">
        <button aria-label="Add files">+</button>
        <div id="prompt-textarea" contenteditable="true" aria-label="Message ChatGPT"
             style="min-width:240px;min-height:40px;border:1px solid #ccc"></div>
        <button aria-label="Start voice mode">mic</button>
        <button data-testid="send-button" aria-label="Send prompt">
          <svg viewBox="0 0 20 20"><path d="M10 3l5 8H5z"/></svg>
        </button>
      </div>
    </div>
  </main>
</body>
</html>`;

describe("composerShell sibling attachment discovery", () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  it("finds 3 logical attachments when cards are siblings of editor", async () => {
    page = await browser.newPage();
    await page.setContent(COMPOSER_HTML);

    const resolution = await resolveComposerShell(page);
    assert.equal(resolution.editorFound, true);
    assert.equal(resolution.shellFound, true);

    // Shell must include attachment row — not editor-only.
    const shellHasAttachments = await resolution.shell
      .locator("#attachment-row")
      .count();
    assert.equal(shellHasAttachments, 1);

    const discovered = await discoverComposerAttachments(page, {
      aiSummaryRequired: true,
    });
    assert.equal(discovered.logicalTypes.metadata, true);
    assert.equal(discovered.logicalTypes.aiSummary, true);
    assert.equal(discovered.logicalTypes.documentsZip, true);
    assert.equal(discovered.matchingExpectedCount, 3);
    assert.ok(discovered.filenames.some((f) => /^metadata/i.test(f)));
    assert.ok(discovered.filenames.some((f) => /^AI_Summary/i.test(f)));
    assert.ok(
      discovered.filenames.some((f) => /^Tender_All_Documents/i.test(f)),
    );

    // Even if token is wrongly placed on editor only, shell walk-up recovers.
    await page.locator("#prompt-textarea").evaluate((el) => {
      el.setAttribute(
        "data-agenttender-composer-token",
        "tok-editor-only",
      );
    });
    const recovered = await countComposerAttachmentCards(page, {
      composerToken: "tok-editor-only",
      aiSummaryRequired: true,
    });
    assert.equal(recovered.logicalAttachmentCount, 3);
    assert.equal(recovered.logicalMetadata, true);
    assert.equal(recovered.logicalAiSummary, true);
    assert.equal(recovered.logicalDocumentsZip, true);
    // Must NOT regress to structural-only zero when filenames are visible.
    assert.notEqual(recovered.logicalAttachmentCount, 0);

    const files: QualificationAttachmentFile[] = [
      {
        kind: "METADATA",
        filePath: "/tmp/metadata.json",
        fileName: "metadata.json",
        required: true,
      },
      {
        kind: "AI_SUMMARY",
        filePath: "/tmp/AI_Summary.pdf",
        fileName: "AI_Summary.pdf",
        required: true,
      },
      {
        kind: "DOCUMENT_ARCHIVE",
        filePath: "/tmp/Tender_All_Documents.zip",
        fileName: "Tender_All_Documents.zip",
        required: true,
      },
    ];
    const manifest = buildTender247ExpectedManifest(files);
    const first = evaluateAttachmentStabilityPoll({
      composerCount: 0, // old brittle structural count
      logicalAttachmentCount: recovered.logicalAttachmentCount,
      displayedNames: recovered.displayedNames,
      manifest,
      previousStableCount: null,
      consecutiveStablePolls: 0,
    });
    assert.equal(first.validation.ok, true);
    assert.equal(first.consecutiveStablePolls, 1);
    const second = evaluateAttachmentStabilityPoll({
      composerCount: 0,
      logicalAttachmentCount: recovered.logicalAttachmentCount,
      displayedNames: recovered.displayedNames,
      manifest,
      previousStableCount: recovered.logicalAttachmentCount,
      consecutiveStablePolls: 1,
    });
    assert.equal(second.stable, true);

    assert.equal(getAttachmentValidationTimeoutMs({}), 60_000);
    await page.close();
  });

  it("ignores historical page-wide attachment names outside shell", async () => {
    page = await browser.newPage();
    await page.setContent(COMPOSER_HTML);
    // Remove current composer attachments — only history remains.
    await page.locator("#attachment-row").evaluate((el) => el.remove());

    const discovered = await discoverComposerAttachments(page, {
      aiSummaryRequired: true,
    });
    assert.equal(discovered.logicalTypes.metadata, false);
    assert.equal(discovered.matchingExpectedCount, 0);
    await page.close();
  });
});
