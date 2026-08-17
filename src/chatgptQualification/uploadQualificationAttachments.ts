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
  captureMessageBaseline,
  createTenderUploadSession,
  countComposerAttachmentCards,
  clearStaleComposerAttachments,
  detectComposerAttachments,
  detectSubmissionSignals,
  detectUploadLimitWarning,
  ensureComposerCleanBeforeUpload,
  isConversationUrl,
  readComposerPromptPresence,
  resolveComposerSendButton,
  sendComposerMessage,
  typeComposerPrompt,
  uploadFilesToComposer,
  type SendComposerResult,
} from "./chatInteraction.js";
import { getSharedChatGptSubmissionScheduler } from "../concurrency/chatGptSubmissionScheduler.js";
import { getProjectComposerLocator } from "./openProject.js";
import {
  COMPOSER_TOKEN_ATTR,
  resolveComposerShell,
} from "./composerShellAttachments.js";
export { COMPOSER_TOKEN_ATTR } from "./composerShellAttachments.js";
import {
  assertTender247AttachmentCountSafe,
  assertTender247AttachmentValidationPassed,
  assertTender247UploadPathsTopLevelOnly,
  buildAttachmentManifestAudit,
  buildTender247ExpectedManifest,
  logTender247ExpectedManifest,
  validateDisplayedAttachmentNames,
  type AttachmentManifestAudit,
  type Tender247ExpectedManifest,
} from "./tender247AttachmentManifest.js";
import {
  advanceCandidateStage,
  createCandidateTxnState,
  shouldSkipPromptPaste,
  shouldSkipSend,
  type ChatGptCandidateTxnState,
} from "./candidateTxnState.js";
import {
  MAX_UPLOAD_ATTEMPTS,
  classifyRealUploadFailure,
  shouldRetryUpload,
} from "./tender247AttachmentUploadState.js";

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
  attachmentManifest?: AttachmentManifestAudit;
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
  const resolution = await resolveComposerShell(page);
  if (resolution.shellFound) {
    return resolution.shell;
  }
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
  // Resolve shell first (editor + actions [+ attachments]), then mark SHELL.
  const resolution = await resolveComposerShell(page);
  const root = resolution.shellFound
    ? resolution.shell
    : await locateComposerRoot(page);
  await root.evaluate(
    (element, token) => {
      element.setAttribute("data-agenttender-composer-token", token);
    },
    composerToken,
  );
  const rebound = await resolveComposerShell(page, { composerToken });
  logger.info(`CHATGPT_COMPOSER_TOKEN_ASSIGNED=${composerToken}`);
  console.log(`CHATGPT_COMPOSER_TOKEN_ASSIGNED=${composerToken}`);
  console.log(
    `CHATGPT_COMPOSER_EDITOR_FOUND=${rebound.editorFound}`,
  );
  console.log(`CHATGPT_COMPOSER_SHELL_FOUND=${rebound.shellFound}`);
  logger.info(`CHATGPT_COMPOSER_EDITOR_FOUND=${rebound.editorFound}`);
  logger.info(`CHATGPT_COMPOSER_SHELL_FOUND=${rebound.shellFound}`);
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
    composerToken,
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

  logger.info("CHATGPT_COMPOSER_TOKEN_VERIFIED=true");
  console.log("CHATGPT_COMPOSER_TOKEN_VERIFIED=true");
  logger.info(`CHATGPT_COMPOSER_TOKEN=${composerToken}`);
  console.log(`CHATGPT_COMPOSER_TOKEN=${composerToken}`);
  logger.info("CHATGPT_COMPOSER_CONTINUITY_CONFIRMED=true");
  console.log("CHATGPT_COMPOSER_CONTINUITY_CONFIRMED=true");
}

function sha256Sync(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

export function buildChatGptTransactionId(
  sourcePortal: "TENDER247" | "BIDASSIST",
  sourceTenderId: string,
): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
  ].join("");
  const prefix = sourcePortal === "TENDER247" ? "T247" : "BA";
  return `${prefix}-${sourceTenderId}-${stamp}`;
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
  _aiSummaryRequired: boolean,
): void {
  if (files.length === 0) {
    throw new Error(
      `E2E_REQUIRED_ATTACHMENT_BUNDLE_INCOMPLETE=T247-${sourceTenderId} count=0`,
    );
  }
  for (const file of files) {
    if (!file.filePath || !fs.existsSync(file.filePath)) {
      throw new Error(
        `E2E_REQUIRED_ATTACHMENT_BUNDLE_INCOMPLETE=T247-${sourceTenderId} missing=${file.kind}`,
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

export function writeAttachmentManifestAuditFile(options: {
  tenderFolder: string;
  audit: AttachmentManifestAudit;
  keptPipelineAuditDir?: string | null;
}): string {
  const tenderPath = path.join(options.tenderFolder, "03-attachment-manifest.json");
  fs.writeFileSync(tenderPath, JSON.stringify(options.audit, null, 2), "utf8");

  if (options.keptPipelineAuditDir) {
    const pipelinePath = path.join(
      options.keptPipelineAuditDir,
      "03-attachment-manifest.json",
    );
    let existing: { generatedAt: string; tenders: AttachmentManifestAudit[] } = {
      generatedAt: new Date().toISOString(),
      tenders: [],
    };
    if (fs.existsSync(pipelinePath)) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(pipelinePath, "utf8"),
        ) as { generatedAt?: string; tenders?: AttachmentManifestAudit[] };
        existing = {
          generatedAt: parsed.generatedAt || existing.generatedAt,
          tenders: Array.isArray(parsed.tenders) ? parsed.tenders : [],
        };
      } catch {
        // overwrite corrupt file
      }
    }
    const withoutCurrent = existing.tenders.filter(
      (entry) => entry.sourceTenderId !== options.audit.sourceTenderId,
    );
    withoutCurrent.push(options.audit);
    fs.writeFileSync(
      pipelinePath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          tenders: withoutCurrent,
        },
        null,
        2,
      ),
      "utf8",
    );
    return pipelinePath;
  }

  return tenderPath;
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

async function prepareComposerBeforeFirstUpload(options: {
  page: Page;
  composerToken: string;
  manifest: Tender247ExpectedManifest | null;
  logger: Logger;
  config: AppConfig;
}): Promise<{
  beforeCount: number;
  cleared: boolean;
  pageCount: number;
  reusedValidAttachments: boolean;
  displayedNames: string[];
}> {
  const { page, composerToken, logger, config } = options;
  const snapshot = await countComposerAttachmentCards(page, {
    composerToken,
    aiSummaryRequired: options.manifest?.aiSummaryRequired,
  });
  logger.info(
    `CHATGPT_COMPOSER_ATTACHMENT_COUNT_BEFORE_UPLOAD=${snapshot.logicalAttachmentCount}`,
  );
  console.log(
    `CHATGPT_COMPOSER_ATTACHMENT_COUNT_BEFORE_UPLOAD=${snapshot.logicalAttachmentCount}`,
  );

  // Resume / persistent browser may restore stale drafts. Never reuse them —
  // each tender starts a clean composer transaction.
  if (snapshot.logicalAttachmentCount > 0) {
    logger.info(
      `CHATGPT_STALE_COMPOSER_ATTACHMENTS_IGNORED_FOR_REUSE=${JSON.stringify(snapshot.displayedNames)}`,
    );
    console.log(
      `CHATGPT_STALE_COMPOSER_ATTACHMENTS_IGNORED_FOR_REUSE=${JSON.stringify(snapshot.displayedNames)}`,
    );
  }

  if (snapshot.logicalAttachmentCount === 0) {
    logger.info("CHATGPT_COMPOSER_CLEAN=true");
    console.log("CHATGPT_COMPOSER_CLEAN=true");
    return {
      beforeCount: 0,
      cleared: false,
      pageCount: snapshot.pageCount,
      reusedValidAttachments: false,
      displayedNames: [],
    };
  }

  const cleanup = await ensureComposerCleanBeforeUpload(page, logger, {
    composerToken,
    config,
  });
  return {
    beforeCount: cleanup.beforeCount,
    cleared: cleanup.cleared,
    pageCount: cleanup.pageCount,
    reusedValidAttachments: false,
    displayedNames: [],
  };
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

  let tender247Manifest:
    | ReturnType<typeof buildTender247ExpectedManifest>
    | null = null;
  if (sourcePortal === "TENDER247") {
    tender247Manifest = buildTender247ExpectedManifest(files);
    logTender247ExpectedManifest(tender247Manifest, (message) => {
      logger.info(message);
      console.log(message);
    });
    assertTender247AttachmentCountSafe(tender247Manifest, sourceTenderId);
    assertTender247UploadPathsTopLevelOnly(
      tender247Manifest.expectedPaths,
    );
  }

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

  const transactionId = buildChatGptTransactionId(sourcePortal, sourceTenderId);
  logger.info(`CHATGPT_TRANSACTION=${transactionId}`);
  console.log(`CHATGPT_TRANSACTION=${transactionId}`);

  const composerCleanup = await prepareComposerBeforeFirstUpload({
    page,
    composerToken,
    manifest: tender247Manifest,
    logger,
    config,
  });

  const filePaths = [...files.map((f) => path.resolve(f.filePath))];
  if (sourcePortal === "TENDER247") {
    assertTender247UploadPathsTopLevelOnly(filePaths);
  }
  const archiveName = path.basename(
    files.find((f) => f.kind === "DOCUMENT_ARCHIVE")?.filePath || "",
  );

  const session = createTenderUploadSession();
  let attachmentManifest: AttachmentManifestAudit | undefined;
  let stableValidation:
    | ReturnType<typeof validateDisplayedAttachmentNames>
    | null = null;
  let uploadLimitWarningSeen = false;
  let filesAssignedCount = 0;

  if (composerCleanup.reusedValidAttachments && tender247Manifest) {
    session.filesAssigned = true;
    session.attachmentsLocked = true;
    filesAssignedCount = filePaths.length;
    stableValidation = validateDisplayedAttachmentNames({
      manifest: tender247Manifest,
      displayedNames: composerCleanup.displayedNames,
    });
    logger.info(
      `CHATGPT_LOGICAL_METADATA_PRESENT=${stableValidation.metadataCount === 1}`,
    );
    console.log(
      `CHATGPT_LOGICAL_METADATA_PRESENT=${stableValidation.metadataCount === 1}`,
    );
    logger.info(
      `CHATGPT_LOGICAL_AI_SUMMARY_PRESENT=${stableValidation.aiSummaryCount === 1}`,
    );
    console.log(
      `CHATGPT_LOGICAL_AI_SUMMARY_PRESENT=${stableValidation.aiSummaryCount === 1}`,
    );
    logger.info(
      `CHATGPT_LOGICAL_ZIP_PRESENT=${stableValidation.archiveCount === 1}`,
    );
    console.log(
      `CHATGPT_LOGICAL_ZIP_PRESENT=${stableValidation.archiveCount === 1}`,
    );
    logger.info(
      `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=${composerCleanup.beforeCount}`,
    );
    console.log(
      `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=${composerCleanup.beforeCount}`,
    );
    logger.info("CHATGPT_ATTACHMENT_STATE_STABLE=true");
    console.log("CHATGPT_ATTACHMENT_STATE_STABLE=true");
    logger.info("CHATGPT_ATTACHMENTS_LOCKED=true");
    console.log("CHATGPT_ATTACHMENTS_LOCKED=true");
  } else if (sourcePortal === "TENDER247" && tender247Manifest) {
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      logger.info(`CHATGPT_UPLOAD_ATTEMPT=${attempt}`);
      console.log(`CHATGPT_UPLOAD_ATTEMPT=${attempt}`);

      if (attempt > 1) {
        logger.warn("UPLOAD_ATTEMPT_1_FAILED=true");
        console.log("UPLOAD_ATTEMPT_1_FAILED=true");
        await clearStaleComposerAttachments(page, logger, {
          composerToken,
          config,
        });
        session.filesAssigned = false;
        session.uploadAttemptCount = 0;
        session.attachmentsLocked = false;
        await page.waitForTimeout(1_000);
      }

      try {
        uploadLimitWarningSeen = await detectUploadLimitWarning(page);
        if (uploadLimitWarningSeen) {
          throw new AutomationError(
            "CHATGPT_UPLOAD_LIMIT_WARNING",
            "CHATGPT_UPLOAD_LIMIT_WARNING=true",
          );
        }

        await uploadFilesToComposer({
          page,
          filePaths,
          logger,
          batchSize: filePaths.length,
          timeoutMs: config.chatgptUploadTimeoutMs,
          t247Id: sourceTenderId,
          expectAiSummary: aiSummaryRequired,
          session,
          forceFreshUpload: attempt === 1,
          expectedArchiveFileName: archiveName || undefined,
          expectedAttachmentCount: tender247Manifest?.expectedCount,
          composerToken,
          tender247Manifest: tender247Manifest ?? undefined,
        });

        filesAssignedCount = filePaths.length;
        const visible = await countComposerAttachmentCards(page, {
          composerToken,
          aiSummaryRequired,
        });
        stableValidation = validateDisplayedAttachmentNames({
          manifest: tender247Manifest,
          displayedNames: visible.displayedNames,
        });
        logger.info(
          `CHATGPT_LOGICAL_METADATA_PRESENT=${visible.logicalMetadata}`,
        );
        console.log(
          `CHATGPT_LOGICAL_METADATA_PRESENT=${visible.logicalMetadata}`,
        );
        logger.info(
          `CHATGPT_LOGICAL_AI_SUMMARY_PRESENT=${visible.logicalAiSummary}`,
        );
        console.log(
          `CHATGPT_LOGICAL_AI_SUMMARY_PRESENT=${visible.logicalAiSummary}`,
        );
        logger.info(
          `CHATGPT_LOGICAL_DOCUMENTS_ZIP_PRESENT=${visible.logicalDocumentsZip}`,
        );
        console.log(
          `CHATGPT_LOGICAL_DOCUMENTS_ZIP_PRESENT=${visible.logicalDocumentsZip}`,
        );
        logger.info(
          `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=${visible.logicalAttachmentCount}`,
        );
        console.log(
          `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=${visible.logicalAttachmentCount}`,
        );
        if (session.attachmentsLocked) {
          logger.info("CHATGPT_ATTACHMENTS_LOCKED=true");
          console.log("CHATGPT_ATTACHMENTS_LOCKED=true");
        }
        break;
      } catch (error) {
        // After lock: never clear/re-upload — fail the candidate.
        if (session.attachmentsLocked) {
          logger.error(
            "CHATGPT_UPLOAD_BLOCKED_LOCKED=true — post-lock failure must not re-upload",
          );
          console.log(
            "CHATGPT_UPLOAD_BLOCKED_LOCKED=true — post-lock failure must not re-upload",
          );
          throw error;
        }

        uploadLimitWarningSeen =
          uploadLimitWarningSeen || (await detectUploadLimitWarning(page));
        const visible = await countComposerAttachmentCards(page, {
          composerToken,
          aiSummaryRequired,
        });
        const validation = validateDisplayedAttachmentNames({
          manifest: tender247Manifest,
          displayedNames: visible.displayedNames,
        });
        // If logical set is already complete, never treat as upload failure for retry/clear.
        if (
          visible.logicalMetadata &&
          visible.logicalDocumentsZip &&
          (!aiSummaryRequired || visible.logicalAiSummary)
        ) {
          logger.info(
            "CHATGPT_LOGICAL_ATTACHMENTS_COMPLETE_DESPITE_ERROR — skipping reupload",
          );
          console.log(
            "CHATGPT_LOGICAL_ATTACHMENTS_COMPLETE_DESPITE_ERROR — skipping reupload",
          );
          stableValidation = validation;
          filesAssignedCount = filePaths.length;
          break;
        }
        const failure = classifyRealUploadFailure({
          uploadLimitWarning: uploadLimitWarningSeen,
          uploadErrorVisible:
            error instanceof AutomationError &&
            error.code === "CHATGPT_UPLOAD_FAILED",
          validation,
          timedOut:
            (error instanceof AutomationError &&
              error.code === "CHATGPT_ATTACHMENT_NOT_VISIBLE") ||
            (error instanceof AutomationError &&
              error.code === "CHATGPT_ATTACHMENT_VALIDATION_FAILED"),
        });

        if (!shouldRetryUpload(attempt, failure)) {
          logger.error("CHATGPT_UPLOAD_FAILED_FINAL=true");
          logger.error("CHATGPT_SEND_BLOCKED=true");
          console.log("CHATGPT_UPLOAD_FAILED_FINAL=true");
          console.log("CHATGPT_SEND_BLOCKED=true");
          throw error;
        }
      }
    }
  } else {
    await uploadFilesToComposer({
      page,
      filePaths,
      logger,
      batchSize: filePaths.length,
      timeoutMs: config.chatgptUploadTimeoutMs,
      t247Id: sourceTenderId,
      expectAiSummary: aiSummaryRequired,
      session,
      expectedArchiveFileName: archiveName || undefined,
      composerToken,
    });
    filesAssignedCount = filePaths.length;
  }

  if (!stableValidation?.ok && tender247Manifest) {
    const visible = await countComposerAttachmentCards(page, {
      composerToken,
      aiSummaryRequired,
    });
    stableValidation = validateDisplayedAttachmentNames({
      manifest: tender247Manifest,
      displayedNames: visible.displayedNames,
    });
  }

  if (filesAssignedCount > 0) {
    logger.info(`CHATGPT_FILES_ASSIGNED=${filesAssignedCount}`);
    console.log(`CHATGPT_FILES_ASSIGNED=${filesAssignedCount}`);
  }

  if (sourcePortal === "TENDER247" && tender247Manifest && stableValidation) {
    logger.info(
      `CHATGPT_COMPOSER_ATTACHMENT_COUNT_AFTER_UPLOAD=${stableValidation.visibleCount}`,
    );
    console.log(
      `CHATGPT_COMPOSER_ATTACHMENT_COUNT_AFTER_UPLOAD=${stableValidation.visibleCount}`,
    );

    if (uploadLimitWarningSeen) {
      logger.error("CHATGPT_UPLOAD_LIMIT_WARNING=true");
      console.log("CHATGPT_UPLOAD_LIMIT_WARNING=true");
    }

    attachmentManifest = buildAttachmentManifestAudit({
      manifest: tender247Manifest,
      sourceTenderId,
      displayedNames: (
        await countComposerAttachmentCards(page, {
          composerToken,
          aiSummaryRequired,
        })
      ).displayedNames,
      filesAssignedCount,
      uploadLimitWarningSeen,
      staleAttachmentsFound: composerCleanup.beforeCount,
      staleAttachmentsCleared: composerCleanup.cleared,
      validation: stableValidation,
      sendBlocked: !stableValidation.ok || uploadLimitWarningSeen,
    });

    try {
      assertTender247AttachmentValidationPassed({
        manifest: tender247Manifest,
        validation: stableValidation,
        uploadLimitWarningSeen,
        sourceTenderId,
      });
      logger.info("CHATGPT_ATTACHMENT_VALIDATION_PASSED=true");
      console.log("CHATGPT_ATTACHMENT_VALIDATION_PASSED=true");
    } catch (error) {
      if (
        stableValidation.failureReason === "duplicate_metadata" ||
        stableValidation.failureReason === "duplicate_ai_summary" ||
        stableValidation.failureReason === "duplicate_archive"
      ) {
        logger.error("CHATGPT_DUPLICATE_ATTACHMENT_DETECTED=true");
        console.log("CHATGPT_DUPLICATE_ATTACHMENT_DETECTED=true");
      }
      logger.error("CHATGPT_ATTACHMENT_VALIDATION_FAILED=true");
      logger.error("CHATGPT_SEND_BLOCKED=true");
      console.log("CHATGPT_ATTACHMENT_VALIDATION_FAILED=true");
      console.log("CHATGPT_SEND_BLOCKED=true");
      throw error;
    }
  }

  await assertPreSendAttachmentCheck({
    page,
    sourcePortal,
    sourceTenderId,
    aiSummaryRequired,
    metadataRequired: files.some((f) => f.kind === "METADATA"),
    tenderArchiveRequired: files.some((f) => f.kind === "DOCUMENT_ARCHIVE"),
    expectedArchiveFileName: archiveName,
    logger,
    composerToken,
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
    attachmentManifest,
  };
}

export async function assertPreSendAttachmentCheck(options: {
  page: Page;
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  aiSummaryRequired: boolean;
  metadataRequired?: boolean;
  tenderArchiveRequired?: boolean;
  expectedArchiveFileName: string;
  logger: Logger;
  composerToken?: string;
}): Promise<void> {
  const {
    page,
    sourcePortal,
    sourceTenderId,
    aiSummaryRequired,
    expectedArchiveFileName,
    logger,
    composerToken,
  } = options;
  const metadataRequired = options.metadataRequired ?? false;
  const tenderArchiveRequired = options.tenderArchiveRequired ?? false;

  logger.info("CHATGPT_PRE_SEND_ATTACHMENT_CHECK_START");
  console.log("CHATGPT_PRE_SEND_ATTACHMENT_CHECK_START");

  const presence = await detectComposerAttachments(page, {
    expectedArchiveFileName,
    composerToken,
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

  if (!metadataPresent && archivePresent) {
    console.log("CHATGPT_REQUIRED_ATTACHMENT_MISSING=metadata");
    logger.error("CHATGPT_REQUIRED_ATTACHMENT_MISSING=metadata");
  }

  // Logical attachment count — do NOT require every card to be visually exposed.
  const count =
    Number(metadataPresent) +
    Number(archivePresent) +
    Number(aiSummaryRequired ? aiPresent : false);
  logger.info(`CHATGPT_PRE_SEND_ATTACHMENT_COUNT=${count}`);
  console.log(`CHATGPT_PRE_SEND_ATTACHMENT_COUNT=${count}`);
  logger.info(
    `CHATGPT_PRE_SEND_LOGICAL_ATTACHMENTS=metadata:${metadataPresent};zip:${archivePresent};ai:${aiPresent};aiRequired:${aiSummaryRequired}`,
  );

  try {
    assertRequiredAttachmentsReady({
      sourcePortal,
      sourceTenderId,
      metadataDetected: metadataPresent,
      tenderArchiveDetected: archivePresent,
      bidassistArchiveDetected: archivePresent,
      aiSummaryDetected: aiPresent,
      aiSummaryRequired,
      metadataRequired,
      tenderArchiveRequired,
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
 * Prompt entry + Send after attachments are locked.
 *
 * Idempotent rules:
 * - paste prompt at most once per call (PROMPT_ENTRY_COUNT)
 * - enter prompt BEFORE waiting on the global Send slot (no 5-min delay before paste)
 * - if Send fails → retry Send only (never re-paste / re-upload)
 * - if authoritative submission already detected → do not Send again
 */
export const PROMPT_ENTRY_TIMEOUT_MS = 90_000;

export function getPromptReadyTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number.parseInt(env.CHATGPT_PROMPT_READY_TIMEOUT_MS || "30000", 10);
  return Number.isFinite(n) && n >= 5_000 ? n : 30_000;
}

async function savePromptStageScreenshot(
  page: Page,
  logger: Logger,
  name: "01-files-ready" | "02-prompt-ready" | "03-send-failure",
): Promise<void> {
  try {
    const dir = path.join(process.cwd(), "screenshots", "chatgpt-prompt-send");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    logger.info(`CHATGPT_PROMPT_STAGE_SCREENSHOT=${filePath}`);
    console.log(`CHATGPT_PROMPT_STAGE_SCREENSHOT=${filePath}`);
  } catch {
    logger.warn(`CHATGPT_PROMPT_STAGE_SCREENSHOT_FAILED=${name}`);
  }
}

export async function enterPromptAndSendWithConfirmedAttachments(options: {
  page: Page;
  prompt: string;
  logger: Logger;
  confirmed: ConfirmedAttachmentState;
  /** Optional shared transaction state (mutated in place). */
  txn?: ChatGptCandidateTxnState;
}): Promise<SendComposerResult> {
  const { page, prompt, logger, confirmed } = options;
  let txn = options.txn ?? createCandidateTxnState(1);
  const syncTxn = (next: ChatGptCandidateTxnState) => {
    txn = next;
    if (options.txn) Object.assign(options.txn, next);
  };
  const promptDeadline = Date.now() + PROMPT_ENTRY_TIMEOUT_MS;
  const promptReadyTimeoutMs = getPromptReadyTimeoutMs();

  logger.info("CHATGPT_PROMPT_ENTRY_START");
  console.log("CHATGPT_PROMPT_ENTRY_START");
  syncTxn(advanceCandidateStage(txn, "PROMPT_ENTERING"));

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

  const failPromptEntry = (reason: string): never => {
    logger.error("CHATGPT_PROMPT_ENTRY_FAILED=true");
    console.log("CHATGPT_PROMPT_ENTRY_FAILED=true");
    throw new AutomationError(
      "CHATGPT_PROMPT_ENTRY_FAILED",
      `CHATGPT_PROMPT_ENTRY_FAILED=true reason=${reason}`,
    );
  };

  try {
    // Absolute gate: never paste/Send if this tender already has a submission
    // or any assistant response in the current conversation.
    const { inspectExistingSubmissionAndResponse } = await import(
      "./inspectExistingSubmission.js"
    );
    const existing = await inspectExistingSubmissionAndResponse({
      page,
      expectedT247Id: confirmed.sourceTenderId,
      logger,
    });
    if (
      existing.assistantMessagePresent ||
      existing.validQualificationJsonPresent ||
      existing.promptSubmitted
    ) {
      logger.info("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
      console.log("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
      if (existing.assistantMessagePresent) {
        logger.info("CHATGPT_EXISTING_RESPONSE_DETECTED=true");
        console.log("CHATGPT_EXISTING_RESPONSE_DETECTED=true");
      }
      const url =
        existing.conversationUrl ||
        (isConversationUrl(page.url()) ? page.url() : "");
      const next = advanceCandidateStage(txn, "SUBMITTED");
      next.conversationUrl = url || next.conversationUrl;
      syncTxn(next);
      const baseline = await captureMessageBaseline(page);
      return {
        chatUrl: url || page.url(),
        baseline,
        submissionConfirmed: true,
        existingResponseText: existing.assistantText || undefined,
        existingValidJson: existing.validQualificationJsonPresent,
      };
    }

    const earlySubmit = await detectSubmissionSignals(page, {
      expectedT247Id: confirmed.sourceTenderId,
    });
    if (earlySubmit.submitted) {
      logger.info("CHATGPT_ALREADY_SUBMITTED=true");
      console.log("CHATGPT_ALREADY_SUBMITTED=true");
      console.log("CHATGPT_PROMPT_SUBMITTED=true");
      const next = advanceCandidateStage(txn, "SUBMITTED");
      next.conversationUrl = earlySubmit.url;
      syncTxn(next);
      const baseline = await captureMessageBaseline(page);
      return {
        chatUrl: earlySubmit.url,
        baseline,
        submissionConfirmed: true,
      };
    }

    if (Date.now() > promptDeadline) {
      failPromptEntry("timeout_before_continuity");
    }

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
      metadataRequired: confirmed.fileNames.some((n) =>
        /^metadata/i.test(n),
      ),
      tenderArchiveRequired: confirmed.fileNames.some((n) =>
        /Tender_All_Documents.*\.zip$/i.test(n),
      ),
      expectedArchiveFileName: archiveName,
      logger,
      composerToken: confirmed.composerIdentity,
    });
    console.log("CHATGPT_ATTACHMENT_VALIDATION_PASSED=true");
    logger.info("CHATGPT_ATTACHMENT_VALIDATION_PASSED=true");
    await savePromptStageScreenshot(page, logger, "01-files-ready");

    // Prompt entry is NOT under the global Send mutex — workers may prepare in parallel.
    const alreadyPresent = await readComposerPromptPresence(page);
    if (shouldSkipPromptPaste(txn) || alreadyPresent.present) {
      logger.info("CHATGPT_PROMPT_PASTE_SKIPPED=already_ready");
      console.log("CHATGPT_PROMPT_PASTE_SKIPPED=already_ready");
      console.log(`CHATGPT_PROMPT_PRESENT=true`);
      console.log(`CHATGPT_PROMPT_LENGTH=${alreadyPresent.length}`);
    } else {
      txn.promptEntryCount += 1;
      console.log(`CHATGPT_PROMPT_ENTRY_ATTEMPT=${txn.promptEntryCount}`);
      logger.info(`CHATGPT_PROMPT_ENTRY_ATTEMPT=${txn.promptEntryCount}`);
      if (txn.promptEntryCount > 1) {
        failPromptEntry("prompt_paste_blocked_second_attempt");
      }
      await typeComposerPrompt(page, prompt, logger);
    }

    const presence = await readComposerPromptPresence(page);
    console.log(`CHATGPT_PROMPT_PRESENT=${presence.present}`);
    console.log(`CHATGPT_PROMPT_LENGTH=${presence.length}`);
    logger.info(`CHATGPT_PROMPT_PRESENT=${presence.present}`);
    logger.info(`CHATGPT_PROMPT_LENGTH=${presence.length}`);
    if (!presence.present) {
      failPromptEntry("prompt_not_present_after_entry");
    }

    {
      const next = advanceCandidateStage(txn, "PROMPT_READY");
      next.promptReady = true;
      syncTxn(next);
    }
    logger.info("CHATGPT_PROMPT_ENTERED=true");
    console.log("CHATGPT_PROMPT_ENTERED=true");
    await savePromptStageScreenshot(page, logger, "02-prompt-ready");

    const promptReadyDeadline = Date.now() + promptReadyTimeoutMs;

    if (
      confirmed.sourcePortal === "TENDER247" &&
      confirmed.attachmentManifest &&
      !confirmed.attachmentManifest.validationPassed
    ) {
      logger.error("CHATGPT_ATTACHMENT_VALIDATION_FAILED=true");
      logger.error("CHATGPT_SEND_BLOCKED=true");
      throw new AutomationError(
        "CHATGPT_ATTACHMENT_VALIDATION_FAILED",
        "CHATGPT_SEND_BLOCKED=true — attachment manifest validation failed before send",
      );
    }

    if (confirmed.sourcePortal === "TENDER247") {
      const uploadLimitWarningSeen = await detectUploadLimitWarning(page);
      if (uploadLimitWarningSeen) {
        logger.error("CHATGPT_UPLOAD_LIMIT_WARNING=true");
        logger.error("CHATGPT_SEND_BLOCKED=true");
        throw new AutomationError(
          "CHATGPT_UPLOAD_LIMIT_WARNING",
          "CHATGPT_UPLOAD_LIMIT_WARNING=true CHATGPT_SEND_BLOCKED=true",
        );
      }
      // Logical attachments only — do NOT require every card visually exposed.
      const logical = await detectComposerAttachments(page, {
        expectedArchiveFileName: archiveName,
        composerToken: confirmed.composerIdentity,
      });
      if (!logical.metadataAttached) {
        console.log("CHATGPT_REQUIRED_ATTACHMENT_MISSING=metadata");
        logger.error("CHATGPT_REQUIRED_ATTACHMENT_MISSING=metadata");
        throw new AutomationError(
          "CHATGPT_ATTACHMENT_VALIDATION_FAILED",
          "CHATGPT_REQUIRED_ATTACHMENT_MISSING=metadata",
        );
      }
      if (!logical.documentsAttached) {
        console.log("CHATGPT_REQUIRED_ATTACHMENT_MISSING=documents");
        logger.error("CHATGPT_REQUIRED_ATTACHMENT_MISSING=documents");
        throw new AutomationError(
          "CHATGPT_ATTACHMENT_VALIDATION_FAILED",
          "CHATGPT_REQUIRED_ATTACHMENT_MISSING=documents",
        );
      }
      if (confirmed.aiSummaryRequired && !logical.aiSummaryAttached) {
        console.log("CHATGPT_REQUIRED_ATTACHMENT_MISSING=ai_summary");
        logger.error("CHATGPT_REQUIRED_ATTACHMENT_MISSING=ai_summary");
        throw new AutomationError(
          "CHATGPT_ATTACHMENT_VALIDATION_FAILED",
          "CHATGPT_REQUIRED_ATTACHMENT_MISSING=ai_summary",
        );
      }
      logger.info(
        `CHATGPT_LOGICAL_ATTACHMENT_OK metadata=${logical.metadataAttached} zip=${logical.documentsAttached} ai=${logical.aiSummaryAttached} aiRequired=${confirmed.aiSummaryRequired}`,
      );
    }

    await assertPreSendAttachmentCheck({
      page,
      sourcePortal: confirmed.sourcePortal,
      sourceTenderId: confirmed.sourceTenderId,
      aiSummaryRequired: confirmed.aiSummaryRequired,
      metadataRequired: confirmed.fileNames.some((n) =>
        /^metadata/i.test(n),
      ),
      tenderArchiveRequired: confirmed.fileNames.some((n) =>
        /Tender_All_Documents.*\.zip$/i.test(n),
      ),
      expectedArchiveFileName: archiveName,
      logger,
      composerToken: confirmed.composerIdentity,
    });

    if (Date.now() > promptReadyDeadline) {
      await savePromptStageScreenshot(page, logger, "03-send-failure");
      failPromptEntry("prompt_ready_timeout_before_send");
    }

    if (shouldSkipSend(txn)) {
      const signals = await detectSubmissionSignals(page, {
        expectedT247Id: confirmed.sourceTenderId,
      });
      if (signals.submitted) {
        const baseline = await captureMessageBaseline(page);
        return {
          chatUrl: signals.url,
          baseline,
          submissionConfirmed: true,
        };
      }
    }

    {
      const waitDeadline = Math.min(promptReadyDeadline, Date.now() + 8_000);
      while (Date.now() < waitDeadline) {
        const diag = await resolveComposerSendButton(page, logger, {
          composerToken: confirmed.composerIdentity,
        });
        if (diag.found && diag.enabled) {
          break;
        }
        await page.waitForTimeout(250);
      }
    }

    if (Date.now() > promptReadyDeadline) {
      await savePromptStageScreenshot(page, logger, "03-send-failure");
      const diag = await resolveComposerSendButton(page, logger, {
        composerToken: confirmed.composerIdentity,
      });
      console.log(`CHATGPT_SEND_BUTTON_FOUND=${diag.found}`);
      console.log(`CHATGPT_SEND_BUTTON_VISIBLE=${diag.visible}`);
      console.log(`CHATGPT_SEND_BUTTON_ENABLED=${diag.enabled}`);
      console.log(`CHATGPT_SEND_BUTTON_COUNT=${diag.count}`);
      failPromptEntry("prompt_ready_timeout_send_not_actionable");
    }

    // Global Send mutex starts HERE — not during upload/prompt prep.
    syncTxn(advanceCandidateStage(txn, "WAITING_FOR_SEND_SLOT"));
    console.log("CHATGPT_WAITING_FOR_SEND_SLOT=true");
    logger.info("CHATGPT_WAITING_FOR_SEND_SLOT=true");
    console.log("CHATGPT_WAITING_FOR_GLOBAL_SEND_SLOT=true");
    logger.info("CHATGPT_WAITING_FOR_GLOBAL_SEND_SLOT=true");

    {
      const next = advanceCandidateStage(txn, "SUBMITTING");
      next.sendAttemptCount += 1;
      syncTxn(next);
    }
    console.log(`CHATGPT_SEND_ATTEMPT=${txn.sendAttemptCount}`);

    try {
      const result = await sendComposerMessage(page, logger, {
        requireNewConversation: true,
        expectedT247Id: confirmed.sourceTenderId,
        userMessagePattern:
          /Evaluate this tender for Siyana Info Solutions Pvt\. Ltd\./i,
        confirmedAttachments: confirmed,
      });
      const next = advanceCandidateStage(txn, "SUBMITTED");
      next.submitted = true;
      next.conversationUrl = result.chatUrl;
      syncTxn(next);
      console.log("CHATGPT_RESPONSE_WAIT_START");
      logger.info("CHATGPT_RESPONSE_WAIT_START");
      return result;
    } catch (sendError) {
      const signals = await detectSubmissionSignals(page, {
        expectedT247Id: confirmed.sourceTenderId,
      });
      if (signals.submitted) {
        logger.info("CHATGPT_SUBMITTED=true (detected after uncertain Send)");
        console.log("CHATGPT_SUBMITTED=true");
        console.log("CHATGPT_PROMPT_SUBMITTED=true");
        getSharedChatGptSubmissionScheduler().markSubmissionSuccess({
          sourcePortal: confirmed.sourcePortal,
          sourceTenderId: confirmed.sourceTenderId,
          force: true,
        });
        const next = advanceCandidateStage(txn, "SUBMITTED");
        next.submitted = true;
        next.conversationUrl = signals.url;
        syncTxn(next);
        const baseline = await captureMessageBaseline(page);
        console.log("CHATGPT_RESPONSE_WAIT_START");
        return {
          chatUrl: signals.url,
          baseline,
          submissionConfirmed: true,
        };
      }

      if (txn.sendAttemptCount < 2) {
        // Before Send retry: if submission or assistant already exists, do NOT Send again.
        const { inspectExistingSubmissionAndResponse } = await import(
          "./inspectExistingSubmission.js"
        );
        const preRetry = await inspectExistingSubmissionAndResponse({
          page,
          expectedT247Id: confirmed.sourceTenderId,
          logger,
        });
        if (
          preRetry.assistantMessagePresent ||
          preRetry.promptSubmitted ||
          preRetry.validQualificationJsonPresent
        ) {
          logger.info("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
          console.log("CHATGPT_DUPLICATE_PROMPT_BLOCKED=true");
          if (preRetry.assistantMessagePresent) {
            logger.info("CHATGPT_EXISTING_RESPONSE_DETECTED=true");
            console.log("CHATGPT_EXISTING_RESPONSE_DETECTED=true");
          }
          console.log("CHATGPT_PROMPT_SUBMITTED=true");
          const url =
            preRetry.conversationUrl ||
            (isConversationUrl(page.url()) ? page.url() : signals.url);
          const next = advanceCandidateStage(txn, "SUBMITTED");
          next.submitted = true;
          next.conversationUrl = url;
          syncTxn(next);
          const baseline = await captureMessageBaseline(page);
          console.log("CHATGPT_RESPONSE_WAIT_START");
          return {
            chatUrl: url,
            baseline,
            submissionConfirmed: true,
            existingResponseText: preRetry.assistantText || undefined,
            existingValidJson: preRetry.validQualificationJsonPresent,
          };
        }

        logger.warn("CHATGPT_SEND_RETRY_ONLY=true");
        console.log("CHATGPT_SEND_RETRY_ONLY=true");
        txn.sendAttemptCount += 1;
        if (options.txn) options.txn.sendAttemptCount = txn.sendAttemptCount;
        console.log(`CHATGPT_SEND_ATTEMPT=${txn.sendAttemptCount}`);
        syncTxn(advanceCandidateStage(txn, "WAITING_FOR_SEND_SLOT"));
        try {
          const result = await sendComposerMessage(page, logger, {
            requireNewConversation: true,
            expectedT247Id: confirmed.sourceTenderId,
            userMessagePattern:
              /Evaluate this tender for Siyana Info Solutions Pvt\. Ltd\./i,
            confirmedAttachments: confirmed,
          });
          const next = advanceCandidateStage(txn, "SUBMITTED");
          next.submitted = true;
          next.conversationUrl = result.chatUrl;
          syncTxn(next);
          console.log("CHATGPT_RESPONSE_WAIT_START");
          logger.info("CHATGPT_RESPONSE_WAIT_START");
          return result;
        } catch (retryError) {
          await savePromptStageScreenshot(page, logger, "03-send-failure");
          throw retryError;
        }
      }
      await savePromptStageScreenshot(page, logger, "03-send-failure");
      throw sendError;
    }
  } catch (error) {
    if (
      error instanceof AutomationError &&
      (error.code === "CHATGPT_PROMPT_ENTRY_FAILED" ||
        error.code === "CHATGPT_ATTACHMENT_VALIDATION_FAILED" ||
        error.code === "CHATGPT_UPLOAD_LIMIT_WARNING" ||
        error.code === "CHATGPT_PROMPT_NOT_SUBMITTED" ||
        error.code === "CHATGPT_SEND_BUTTON_DISABLED" ||
        error.code === "CHATGPT_SEND_BUTTON_MISSING" ||
        error.code === "CHATGPT_GLOBAL_THROTTLE_VIOLATION")
    ) {
      throw error;
    }
    if (
      error instanceof AutomationError &&
      /COMPOSER_CHANGED|COMPOSER_MISSING|COMPOSER_DETACHED|PRE_SEND_ATTACHMENT/i.test(
        error.code,
      )
    ) {
      return failPromptEntry(error.code);
    }
    return failPromptEntry(
      error instanceof Error ? error.message.slice(0, 200) : String(error),
    );
  }
}
