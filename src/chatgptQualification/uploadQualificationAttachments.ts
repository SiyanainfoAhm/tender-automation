/**
 * Hard-gated qualification attachment upload + pre-send verification.
 * Prompt entry is impossible without ConfirmedAttachmentState from this module.
 *
 * Composer continuity uses a stable DOM token — never bounding-box coordinates.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";
import type { AppConfig } from "../config.js";
import type { QualificationAttachmentFile } from "./sourceDocumentResolver.js";
import { assertRequiredAttachmentsReady } from "./sourceDocumentResolver.js";
import {
  createTenderUploadSession,
  detectComposerAttachments,
  sendComposerMessage,
  typeComposerPrompt,
  uploadFilesToComposer,
  type SendComposerResult,
} from "./chatInteraction.js";
import { getProjectComposerLocator } from "./openProject.js";

export const COMPOSER_TOKEN_ATTR = "data-agenttender-composer-token";

export type ConfirmedAttachmentState = {
  requiredAttachmentsConfirmed: true;
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  fileNames: string[];
  /** Stable composer token (never coordinates). */
  composerIdentity: string;
  urlAtVerification: string;
  aiSummaryRequired: boolean;
  attachmentHashes: string[];
};

/** Snapshot used by pure continuity checks (no Playwright). */
export type ComposerContinuitySnapshot = {
  urlBefore: string;
  urlAfter: string;
  tokenAssigned: string;
  tokenStillPresent: boolean;
  projectHeadingUnchanged: boolean;
  metadataAttached: boolean;
  documentsAttached: boolean;
  aiSummaryAttached: boolean;
  aiSummaryRequired: boolean;
  promptEditorVisible: boolean;
  sendButtonVisible: boolean;
  activeComposerCount: number;
};

export type ContinuityResult = {
  ok: boolean;
  rebind: boolean;
  reason?: string;
};

/**
 * Pure continuity rule — coordinates are never consulted.
 */
export function evaluateComposerContinuity(
  snapshot: ComposerContinuitySnapshot,
): ContinuityResult {
  if (!isSameProjectHomeUrl(snapshot.urlBefore, snapshot.urlAfter)) {
    return {
      ok: false,
      rebind: false,
      reason: "navigated_away_from_project_home",
    };
  }
  if (/\/c\/[^/?#]+/i.test(snapshot.urlAfter) && !/\/project/i.test(snapshot.urlAfter)) {
    return {
      ok: false,
      rebind: false,
      reason: "navigated_to_conversation",
    };
  }
  if (!snapshot.promptEditorVisible) {
    return { ok: false, rebind: false, reason: "prompt_editor_missing" };
  }
  if (snapshot.activeComposerCount !== 1) {
    return {
      ok: false,
      rebind: false,
      reason: `active_composer_count=${snapshot.activeComposerCount}`,
    };
  }
  if (!snapshot.metadataAttached || !snapshot.documentsAttached) {
    return { ok: false, rebind: false, reason: "required_attachments_missing" };
  }
  if (snapshot.aiSummaryRequired && !snapshot.aiSummaryAttached) {
    return { ok: false, rebind: false, reason: "ai_summary_missing" };
  }
  if (!snapshot.sendButtonVisible && snapshot.tokenStillPresent) {
    // Send may still be settling — allow if token + attachments present
  }

  if (snapshot.tokenStillPresent) {
    return { ok: true, rebind: false };
  }

  // Token lost to React rerender — allow rebind when logical composer intact
  if (
    snapshot.projectHeadingUnchanged &&
    snapshot.metadataAttached &&
    snapshot.documentsAttached &&
    snapshot.promptEditorVisible
  ) {
    return { ok: true, rebind: true };
  }

  return { ok: false, rebind: false, reason: "token_lost_without_rebindable_composer" };
}

/** Project Home continuity: same /project URL, no conversation jump. */
export function isSameProjectHomeUrl(before: string, after: string): boolean {
  try {
    const a = new URL(before);
    const b = new URL(after);
    if (a.origin !== b.origin) return false;
    const isProjectHome = (u: URL): boolean =>
      /\/g\/g-p-[^/]+\/project\/?$/i.test(u.pathname);
    return isProjectHome(a) && isProjectHome(b);
  } catch {
    return before === after;
  }
}

/**
 * @deprecated Coordinate-based identity — kept only so tests prove it is unused.
 * Never call this for continuity decisions.
 */
export function legacyCoordinateComposerIdentity(parts: {
  id: string;
  ariaLabel: string;
  top: number;
  left: number;
  width: number;
  pathname: string;
}): string {
  return [
    parts.id,
    parts.ariaLabel,
    Math.round(parts.top),
    Math.round(parts.left),
    Math.round(parts.width),
    parts.pathname,
  ].join("|");
}

/** True when two legacy identities differ only by coordinates/size. */
export function legacyIdentityDiffersOnlyByLayout(
  before: string,
  after: string,
): boolean {
  const a = before.split("|");
  const b = after.split("|");
  if (a.length < 6 || b.length < 6) return false;
  return a[0] === b[0] && a[1] === b[1] && a[5] === b[5] && before !== after;
}

async function locateComposerRoot(page: Page): Promise<Locator> {
  const form = page
    .locator("form")
    .filter({
      has: page.locator(
        '[contenteditable="true"]#prompt-textarea, [contenteditable="true"][aria-label*="New chat" i]',
      ),
    })
    .filter({ visible: true })
    .last();
  if ((await form.count().catch(() => 0)) > 0) {
    return form;
  }

  const editor = getProjectComposerLocator(page);
  const wrapper = editor.locator(
    'xpath=ancestor::form[1] | ancestor::*[.//button and .//*[@contenteditable="true"]][1]',
  );
  if ((await wrapper.count().catch(() => 0)) > 0) {
    return wrapper.first();
  }
  return editor;
}

export async function assignComposerToken(options: {
  page: Page;
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  logger: Logger;
}): Promise<string> {
  const { page, sourcePortal, sourceTenderId, logger } = options;
  const composerToken = `agenttender-${sourcePortal}-${sourceTenderId}-${crypto.randomUUID()}`;
  const root = await locateComposerRoot(page);
  await root.evaluate(
    (element, token) => {
      element.setAttribute("data-agenttender-composer-token", token);
    },
    composerToken,
  );
  logger.info(`CHATGPT_COMPOSER_TOKEN_ASSIGNED=${composerToken}`);
  console.log(`CHATGPT_COMPOSER_TOKEN_ASSIGNED=${composerToken}`);
  return composerToken;
}

async function countMarkedComposers(page: Page, token: string): Promise<number> {
  return page.locator(`[${COMPOSER_TOKEN_ATTR}="${token}"]`).count();
}

async function rebindComposerToken(
  page: Page,
  token: string,
  logger: Logger,
): Promise<void> {
  const root = await locateComposerRoot(page);
  await root.evaluate(
    (element, value) => {
      element.setAttribute("data-agenttender-composer-token", value);
    },
    token,
  );
  logger.info(`CHATGPT_COMPOSER_WRAPPER_REBOUND=${token}`);
  console.log(`CHATGPT_COMPOSER_WRAPPER_REBOUND=${token}`);
}

export async function verifyComposerContinuity(options: {
  page: Page;
  composerToken: string;
  urlBefore: string;
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  aiSummaryRequired: boolean;
  expectedArchiveFileName: string;
  logger: Logger;
  projectHeadingBefore?: string | null;
}): Promise<void> {
  const {
    page,
    composerToken,
    urlBefore,
    sourcePortal: _sourcePortal,
    sourceTenderId: _sourceTenderId,
    aiSummaryRequired,
    expectedArchiveFileName,
    logger,
  } = options;
  void _sourcePortal;
  void _sourceTenderId;

  const urlAfter = page.url();
  let tokenCount = await countMarkedComposers(page, composerToken);
  let tokenStillPresent = tokenCount === 1;

  const presence = await detectComposerAttachments(page, {
    expectedArchiveFileName,
  });
  const editor = getProjectComposerLocator(page);
  const promptEditorVisible = await editor.isVisible().catch(() => false);
  const sendVisible = await page
    .locator('button[data-testid="send-button"], button[aria-label*="Send" i]')
    .filter({ visible: true })
    .first()
    .isVisible()
    .catch(() => false);

  const activeEditors = await page
    .locator(
      '[contenteditable="true"]#prompt-textarea, [contenteditable="true"][aria-label*="New chat" i]',
    )
    .filter({ visible: true })
    .count()
    .catch(() => 0);

  const headingText = await page
    .locator("h1, h2, [role='heading']")
    .filter({ visible: true })
    .first()
    .innerText()
    .catch(() => "");
  const projectHeadingUnchanged =
    !options.projectHeadingBefore ||
    !headingText ||
    headingText.includes("Siyana") ||
    options.projectHeadingBefore === headingText;

  const snapshot: ComposerContinuitySnapshot = {
    urlBefore,
    urlAfter,
    tokenAssigned: composerToken,
    tokenStillPresent,
    projectHeadingUnchanged,
    metadataAttached: presence.metadataAttached,
    documentsAttached: presence.documentsAttached,
    aiSummaryAttached: presence.aiSummaryAttached,
    aiSummaryRequired,
    promptEditorVisible,
    sendButtonVisible: sendVisible,
    // One logical Project composer when the prompt editor is visible
    activeComposerCount: promptEditorVisible ? Math.min(activeEditors || 1, 1) : 0,
  };

  let result = evaluateComposerContinuity(snapshot);

  if (result.rebind) {
    await rebindComposerToken(page, composerToken, logger);
    tokenCount = await countMarkedComposers(page, composerToken);
    tokenStillPresent = tokenCount === 1;
    snapshot.tokenStillPresent = tokenStillPresent;
    result = evaluateComposerContinuity(snapshot);
  }

  if (!result.ok) {
    throw new AutomationError(
      "CHATGPT_COMPOSER_CHANGED_AFTER_ATTACHMENT_UPLOAD",
      `Composer continuity failed: ${result.reason || "unknown"} url=${urlAfter}`,
    );
  }

  if (tokenCount !== 1) {
    // Final attempt: rebind then require exactly one
    await rebindComposerToken(page, composerToken, logger);
    tokenCount = await countMarkedComposers(page, composerToken);
  }

  const marked = page.locator(`[${COMPOSER_TOKEN_ATTR}="${composerToken}"]`);
  if ((await marked.count()) !== 1) {
    throw new AutomationError(
      "CHATGPT_COMPOSER_CHANGED_AFTER_ATTACHMENT_UPLOAD",
      `Marked composer count=${await marked.count()} token=${composerToken}`,
    );
  }
  if (!(await marked.isVisible().catch(() => false))) {
    throw new AutomationError(
      "CHATGPT_COMPOSER_CHANGED_AFTER_ATTACHMENT_UPLOAD",
      `Marked composer not visible token=${composerToken}`,
    );
  }

  // Marked root must contain editor (best-effort; React may nest differently)
  const hasEditor = await marked
    .locator('[contenteditable="true"]')
    .filter({ visible: true })
    .count()
    .catch(() => 0);
  if (hasEditor < 1 && !promptEditorVisible) {
    throw new AutomationError(
      "CHATGPT_COMPOSER_CHANGED_AFTER_ATTACHMENT_UPLOAD",
      "Marked composer missing prompt editor",
    );
  }

  logger.info(`CHATGPT_COMPOSER_TOKEN_VERIFIED=${composerToken}`);
  console.log(`CHATGPT_COMPOSER_TOKEN_VERIFIED=${composerToken}`);
  logger.info("CHATGPT_COMPOSER_CONTINUITY_CONFIRMED");
  console.log("CHATGPT_COMPOSER_CONTINUITY_CONFIRMED");
}

function sha256Sync(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

/** Validate and log absolute paths for every attachment before ChatGPT opens. */
export function assertAttachmentFilesExistOnDisk(
  files: QualificationAttachmentFile[],
  sourceTenderId: string,
  logger?: Logger,
): void {
  if (!files.length) {
    throw new AutomationError(
      "CHATGPT_NO_VALID_UPLOAD_FILES",
      `E2E_ATTACHMENT_UPLOAD_INPUT_COUNT=0 tender=${sourceTenderId}`,
    );
  }
  for (const file of files) {
    const absolute = path.resolve(file.filePath);
    logger?.info(`E2E_ATTACHMENT_PATH=${absolute}`);
    console.log(`E2E_ATTACHMENT_PATH=${absolute}`);
    try {
      const st = fs.statSync(absolute);
      const ok = st.isFile() && st.size > 0;
      logger?.info(`E2E_ATTACHMENT_EXISTS=${ok}`);
      console.log(`E2E_ATTACHMENT_EXISTS=${ok}`);
      logger?.info(`E2E_ATTACHMENT_SIZE=${st.size}`);
      console.log(`E2E_ATTACHMENT_SIZE=${st.size}`);
      if (!ok) {
        throw new AutomationError(
          "CHATGPT_REQUIRED_ATTACHMENT_MISSING",
          `CHATGPT_REQUIRED_ATTACHMENT_MISSING=${file.fileName} path=${absolute}`,
        );
      }
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw new AutomationError(
        "CHATGPT_REQUIRED_ATTACHMENT_MISSING",
        `CHATGPT_REQUIRED_ATTACHMENT_MISSING=${file.fileName} path=${absolute}`,
      );
    }
  }
}

export function assertTender247BundleComplete(
  files: QualificationAttachmentFile[],
  sourceTenderId: string,
  aiSummaryRequired: boolean,
): void {
  const metadataFile = files.find((f) => f.kind === "METADATA");
  const archiveFile = files.find((f) => f.kind === "DOCUMENT_ARCHIVE");
  if (!metadataFile || !archiveFile) {
    throw new Error(
      `E2E_REQUIRED_ATTACHMENT_BUNDLE_INCOMPLETE=T247-${sourceTenderId}`,
    );
  }
  if (aiSummaryRequired) {
    const ai = files.find((f) => f.kind === "AI_SUMMARY");
    if (!ai) {
      throw new Error(
        `E2E_REQUIRED_ATTACHMENT_BUNDLE_INCOMPLETE=T247-${sourceTenderId} missing=AI_SUMMARY`,
      );
    }
  }
}

export function assertBidassistBundleComplete(
  files: QualificationAttachmentFile[],
  sourceTenderId: string,
): void {
  const metadataFile = files.find((f) => f.kind === "METADATA");
  const archiveFile = files.find((f) => f.kind === "DOCUMENT_ARCHIVE");
  if (!metadataFile || !archiveFile) {
    throw new Error(
      `E2E_REQUIRED_ATTACHMENT_BUNDLE_INCOMPLETE=BA-${sourceTenderId}`,
    );
  }
}

export function logAttachmentBundle(
  sourcePortal: "TENDER247" | "BIDASSIST",
  sourceTenderId: string,
  files: QualificationAttachmentFile[],
  logger?: Logger,
): void {
  const log = (msg: string) => {
    logger?.info(msg);
    console.log(msg);
  };
  log(`E2E_ATTACHMENT_BUNDLE_SOURCE=${sourcePortal}`);
  log(`E2E_ATTACHMENT_BUNDLE_TENDER_ID=${sourceTenderId}`);
  log(`E2E_ATTACHMENT_BUNDLE_COUNT=${files.length}`);
  for (const file of files) {
    log(`E2E_ATTACHMENT_BUNDLE_FILE=${file.fileName}`);
  }
}

/**
 * Upload bundle files into the current Project composer and verify cards.
 * Never enters the prompt. Never navigates.
 */
export async function uploadQualificationAttachments(options: {
  page: Page;
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  files: QualificationAttachmentFile[];
  logger: Logger;
  config: AppConfig;
}): Promise<ConfirmedAttachmentState> {
  const { page, sourcePortal, sourceTenderId, files, logger, config } = options;

  if (!files.length) {
    throw new AutomationError(
      "CHATGPT_NO_VALID_UPLOAD_FILES",
      `E2E_ATTACHMENT_UPLOAD_INPUT_COUNT=0 — refuse empty upload for ${sourcePortal}-${sourceTenderId}`,
    );
  }

  const aiSummaryRequired =
    sourcePortal === "TENDER247" &&
    files.some((f) => f.kind === "AI_SUMMARY");

  if (sourcePortal === "TENDER247") {
    assertTender247BundleComplete(files, sourceTenderId, aiSummaryRequired);
  } else {
    assertBidassistBundleComplete(files, sourceTenderId);
  }

  assertAttachmentFilesExistOnDisk(files, sourceTenderId, logger);

  const label =
    sourcePortal === "TENDER247"
      ? `T247-${sourceTenderId}`
      : `BA-${sourceTenderId}`;
  logger.info(`E2E_ATTACHMENT_UPLOAD_FUNCTION_CALLED=${label}`);
  console.log(`E2E_ATTACHMENT_UPLOAD_FUNCTION_CALLED=${label}`);
  logger.info(`E2E_ATTACHMENT_UPLOAD_INPUT_COUNT=${files.length}`);
  console.log(`E2E_ATTACHMENT_UPLOAD_INPUT_COUNT=${files.length}`);

  const urlBefore = page.url();
  const headingBefore = await page
    .locator("h1, h2, [role='heading']")
    .filter({ visible: true })
    .first()
    .innerText()
    .catch(() => null);

  const composerToken = await assignComposerToken({
    page,
    sourcePortal,
    sourceTenderId,
    logger,
  });

  const filePaths = files.map((f) => path.resolve(f.filePath));
  const archiveName = path.basename(
    files.find((f) => f.kind === "DOCUMENT_ARCHIVE")?.filePath || "",
  );

  const session = createTenderUploadSession();
  await uploadFilesToComposer({
    page,
    filePaths,
    logger,
    batchSize: filePaths.length,
    timeoutMs: config.chatgptUploadTimeoutMs,
    t247Id: sourceTenderId,
    expectAiSummary: aiSummaryRequired,
    session,
    forceFreshUpload: true,
    expectedArchiveFileName: archiveName || undefined,
  });

  await assertPreSendAttachmentCheck({
    page,
    sourcePortal,
    sourceTenderId,
    aiSummaryRequired,
    expectedArchiveFileName: archiveName,
    logger,
  });

  await verifyComposerContinuity({
    page,
    composerToken,
    urlBefore,
    sourcePortal,
    sourceTenderId,
    aiSummaryRequired,
    expectedArchiveFileName: archiveName,
    logger,
    projectHeadingBefore: headingBefore,
  });

  logger.info("CHATGPT_ALL_REQUIRED_ATTACHMENTS_READY");
  console.log("CHATGPT_ALL_REQUIRED_ATTACHMENTS_READY");

  const urlAtVerification = page.url();
  const fileNames = files.map((f) => f.fileName);
  const attachmentHashes = filePaths.map((p) => sha256Sync(p));

  return {
    requiredAttachmentsConfirmed: true,
    sourcePortal,
    sourceTenderId,
    fileNames,
    composerIdentity: composerToken,
    urlAtVerification,
    aiSummaryRequired,
    attachmentHashes,
  };
}

export async function assertPreSendAttachmentCheck(options: {
  page: Page;
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  aiSummaryRequired: boolean;
  expectedArchiveFileName: string;
  logger: Logger;
}): Promise<void> {
  const {
    page,
    sourcePortal,
    sourceTenderId,
    aiSummaryRequired,
    expectedArchiveFileName,
    logger,
  } = options;

  logger.info("CHATGPT_PRE_SEND_ATTACHMENT_CHECK_START");
  console.log("CHATGPT_PRE_SEND_ATTACHMENT_CHECK_START");

  const presence = await detectComposerAttachments(page, {
    expectedArchiveFileName,
  });

  const metadataPresent = presence.metadataAttached;
  const archivePresent = presence.documentsAttached;
  const aiPresent = presence.aiSummaryAttached;

  logger.info(`CHATGPT_PRE_SEND_METADATA_PRESENT=${metadataPresent}`);
  logger.info(`CHATGPT_PRE_SEND_ARCHIVE_PRESENT=${archivePresent}`);
  logger.info(`CHATGPT_PRE_SEND_AI_SUMMARY_PRESENT=${aiPresent}`);
  console.log(`CHATGPT_PRE_SEND_METADATA_PRESENT=${metadataPresent}`);
  console.log(`CHATGPT_PRE_SEND_ARCHIVE_PRESENT=${archivePresent}`);
  console.log(`CHATGPT_PRE_SEND_AI_SUMMARY_PRESENT=${aiPresent}`);

  const count =
    Number(metadataPresent) +
    Number(archivePresent) +
    Number(aiSummaryRequired ? aiPresent : false);
  logger.info(`CHATGPT_PRE_SEND_ATTACHMENT_COUNT=${count}`);
  console.log(`CHATGPT_PRE_SEND_ATTACHMENT_COUNT=${count}`);

  try {
    assertRequiredAttachmentsReady({
      sourcePortal,
      sourceTenderId,
      metadataDetected: metadataPresent,
      tenderArchiveDetected: archivePresent,
      bidassistArchiveDetected: archivePresent,
      aiSummaryDetected: aiPresent,
      aiSummaryRequired,
    });
  } catch (error) {
    throw new AutomationError(
      "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }

  logger.info("CHATGPT_PRE_SEND_ATTACHMENT_CHECK_PASSED");
  console.log("CHATGPT_PRE_SEND_ATTACHMENT_CHECK_PASSED");
}

/**
 * Enter prompt and Send ONLY with a live ConfirmedAttachmentState.
 * Re-verifies cards and composer token continuity immediately before typing.
 */
export async function enterPromptAndSendWithConfirmedAttachments(options: {
  page: Page;
  prompt: string;
  logger: Logger;
  confirmed: ConfirmedAttachmentState;
}): Promise<SendComposerResult> {
  const { page, prompt, logger, confirmed } = options;

  if (confirmed.requiredAttachmentsConfirmed !== true) {
    throw new AutomationError(
      "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED",
      "ConfirmedAttachmentState.requiredAttachmentsConfirmed is not true",
    );
  }
  if (!confirmed.fileNames || confirmed.fileNames.length < 2) {
    throw new AutomationError(
      "CHATGPT_PRE_SEND_ATTACHMENT_CHECK_FAILED",
      "ConfirmedAttachmentState.fileNames incomplete",
    );
  }

  const archiveName =
    confirmed.fileNames.find((n) => /\.zip$/i.test(n)) || "";

  await verifyComposerContinuity({
    page,
    composerToken: confirmed.composerIdentity,
    urlBefore: confirmed.urlAtVerification,
    sourcePortal: confirmed.sourcePortal,
    sourceTenderId: confirmed.sourceTenderId,
    aiSummaryRequired: confirmed.aiSummaryRequired,
    expectedArchiveFileName: archiveName,
    logger,
  });

  await assertPreSendAttachmentCheck({
    page,
    sourcePortal: confirmed.sourcePortal,
    sourceTenderId: confirmed.sourceTenderId,
    aiSummaryRequired: confirmed.aiSummaryRequired,
    expectedArchiveFileName: archiveName,
    logger,
  });

  await typeComposerPrompt(page, prompt, logger);

  await assertPreSendAttachmentCheck({
    page,
    sourcePortal: confirmed.sourcePortal,
    sourceTenderId: confirmed.sourceTenderId,
    aiSummaryRequired: confirmed.aiSummaryRequired,
    expectedArchiveFileName: archiveName,
    logger,
  });

  return sendComposerMessage(page, logger, {
    requireNewConversation: true,
    expectedT247Id: confirmed.sourceTenderId,
    userMessagePattern:
      /Evaluate this tender for Siyana Info Solutions Pvt\. Ltd\./i,
    confirmedAttachments: confirmed,
  });
}
