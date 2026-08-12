import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../fileUtils.js";

export type ChatGptTenderStatus =
  | "response_pending"
  | "completed"
  | "failed"
  | "not_ready"
  | "rate_limited"
  | "attachments_confirmed"
  | "invalid_prompt_only";

export type ChatGptTenderPhase =
  | "DISCOVERED"
  | "FILES_VALIDATED"
  | "FILES_UPLOADED"
  | "PROMPT_ENTERED"
  | "SEND_CLICKED"
  | "USER_MESSAGE_CONFIRMED"
  | "CONVERSATION_URL_CONFIRMED"
  | "RESPONSE_PENDING"
  | "RESPONSE_STALLED"
  | "RESPONSE_COMPLETE"
  | "RAW_RESPONSE_SAVED"
  | "RESULT_SAVED"
  | "DB_SYNC_FAILED"
  | "COMPLETED";

export interface ChatGptTenderState {
  t247Id: string;
  sourcePortal?: "TENDER247" | "BIDASSIST";
  sourceTenderId?: string;
  chatUrl: string | null;
  status: ChatGptTenderStatus;
  /** True only after Send + new user message + /c/ URL confirmed. */
  submissionConfirmed?: boolean;
  /** True only after attachment cards were verified before Send. */
  requiredAttachmentsConfirmed?: boolean;
  attachmentFileNames?: string[];
  attachmentCount?: number;
  attachmentHashes?: string[];
  attachmentConfirmedAt?: string;
  composerIdentity?: string | null;
  submittedChatUrl?: string | null;
  phase?: ChatGptTenderPhase;
  promptSubmittedAt?: string;
  updatedAt: string;
  lastObservedAt?: string;
  processingState?: string | null;
  elapsedSeconds?: number;
  assistantCountBefore?: number;
  userCountBefore?: number;
  promptHash?: string | null;
  latestAssistantText?: string | null;
  uiState?: string | null;
  error?: string | null;
  retryCount?: number;
  retryAfter?: string | null;
  missingFiles?: string[];
  aiSummarySha256?: string | null;
  tenderDocumentsSha256?: string | null;
  metadataSha256?: string | null;
  metadataUploaded?: boolean;
  aiSummaryAvailable?: boolean;
  aiSummaryUploaded?: boolean;
  documentArchiveUploaded?: boolean;
  uploadedEvidenceFiles?: string[];
}

export function chatgptStatePath(tenderFolder: string): string {
  return path.join(tenderFolder, "chatgpt-state.json");
}

export function loadChatGptTenderState(
  tenderFolder: string,
): ChatGptTenderState | null {
  const filePath = chatgptStatePath(tenderFolder);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as ChatGptTenderState;
  } catch {
    return null;
  }
}

export function saveChatGptTenderState(
  tenderFolder: string,
  state: ChatGptTenderState,
): void {
  ensureDir(tenderFolder);
  // Never persist Project Home as a conversation URL
  if (state.chatUrl && !/\/c\/[^/?#]+/i.test(state.chatUrl)) {
    state = { ...state, chatUrl: null };
  }
  const next: ChatGptTenderState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    chatgptStatePath(tenderFolder),
    JSON.stringify(next, null, 2),
    "utf8",
  );
}

export function isResumablePendingState(
  state: ChatGptTenderState | null,
): state is ChatGptTenderState & { chatUrl: string } {
  if (
    !state ||
    state.status === "invalid_prompt_only" ||
    !(
      state.status === "response_pending" ||
      state.status === "failed" ||
      state.status === "rate_limited"
    ) ||
    typeof state.chatUrl !== "string" ||
    !/^https?:\/\//i.test(state.chatUrl) ||
    !/\/c\/[^/?#]+/i.test(state.chatUrl)
  ) {
    return false;
  }
  // Must have confirmed submission AND verified attachments — never resume prompt-only chats
  if (state.requiredAttachmentsConfirmed !== true) {
    return false;
  }
  if (
    !Array.isArray(state.attachmentFileNames) ||
    state.attachmentFileNames.length < 2
  ) {
    return false;
  }
  if (!state.sourcePortal || !state.sourceTenderId) {
    return false;
  }
  if (
    !Array.isArray(state.attachmentHashes) ||
    state.attachmentHashes.length < 2
  ) {
    return false;
  }
  if (!state.composerIdentity) {
    return false;
  }
  return state.submissionConfirmed === true;
}

/** Mark a pending chat invalid so the next run creates a fresh Project conversation. */
export function invalidatePendingChatWithoutAttachments(
  tenderFolder: string,
  reason: string,
): void {
  const existing = loadChatGptTenderState(tenderFolder);
  if (!existing) {
    return;
  }
  saveChatGptTenderState(tenderFolder, {
    ...existing,
    status: "invalid_prompt_only",
    submissionConfirmed: false,
    requiredAttachmentsConfirmed: false,
    attachmentFileNames: [],
    attachmentHashes: [],
    attachmentCount: 0,
    composerIdentity: null,
    phase: "DISCOVERED",
    updatedAt: new Date().toISOString(),
    error: reason || "Prompt submitted without required attachments",
    uiState: "attachments_not_confirmed",
  });
}

export function hasInvalidPendingChatUrl(
  state: ChatGptTenderState | null,
): boolean {
  return Boolean(
    state &&
      state.status === "response_pending" &&
      typeof state.chatUrl === "string" &&
      state.chatUrl.length > 0 &&
      !/\/c\/[^/?#]+/i.test(state.chatUrl),
  );
}

/** Per-tender entry in chatgpt-qualification-manifest.json */
export interface QualificationManifestEntry {
  t247Id: string;
  status: string;
  qualificationStatus?: string | null;
  chatUrl?: string | null;
  resultPath?: string | null;
  responsePath?: string | null;
  missingFiles?: string[];
  updatedAt: string;
  error?: string | null;
}

export interface ChatGptQualificationManifest {
  expectedTender247: number;
  readyForChatGpt: number;
  selected: number;
  completed: number;
  skipped: number;
  notReady: number;
  pending: number;
  failed: number;
  date: string;
  updatedAt: string;
  tenders: Record<string, QualificationManifestEntry>;
}

export function qualificationManifestPath(dateFolder: string): string {
  return path.join(dateFolder, "chatgpt-qualification-manifest.json");
}

/** @deprecated old filename — still readable for migration */
function legacyQualificationManifestPath(dateFolder: string): string {
  return path.join(dateFolder, "qualification-manifest.json");
}

export function loadQualificationManifest(
  dateFolder: string,
  dateIso: string,
): ChatGptQualificationManifest {
  const filePath = qualificationManifestPath(dateFolder);
  const legacyPath = legacyQualificationManifestPath(dateFolder);
  const pathToRead = fs.existsSync(filePath)
    ? filePath
    : fs.existsSync(legacyPath)
      ? legacyPath
      : null;

  if (!pathToRead) {
    return emptyManifest(dateIso);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(pathToRead, "utf8")) as Partial<
      ChatGptQualificationManifest
    > & { tenders?: Record<string, QualificationManifestEntry> };
    return {
      ...emptyManifest(dateIso),
      ...raw,
      date: raw.date || dateIso,
      tenders: raw.tenders || {},
    };
  } catch {
    return emptyManifest(dateIso);
  }
}

function emptyManifest(dateIso: string): ChatGptQualificationManifest {
  return {
    expectedTender247: 0,
    readyForChatGpt: 0,
    selected: 0,
    completed: 0,
    skipped: 0,
    notReady: 0,
    pending: 0,
    failed: 0,
    date: dateIso,
    updatedAt: new Date().toISOString(),
    tenders: {},
  };
}

export function upsertQualificationManifestEntry(
  dateFolder: string,
  dateIso: string,
  entry: QualificationManifestEntry,
  totals?: Partial<
    Pick<
      ChatGptQualificationManifest,
      | "expectedTender247"
      | "readyForChatGpt"
      | "selected"
      | "completed"
      | "skipped"
      | "notReady"
      | "pending"
      | "failed"
    >
  >,
): ChatGptQualificationManifest {
  const manifest = loadQualificationManifest(dateFolder, dateIso);
  manifest.date = dateIso;
  manifest.tenders[entry.t247Id] = entry;
  if (totals) {
    Object.assign(manifest, totals);
  }
  // Recompute counters from tenders map when totals not fully provided
  recomputeManifestCounters(manifest);
  if (totals) {
    // Preserve batch-level expected/ready/selected from caller
    if (totals.expectedTender247 !== undefined) {
      manifest.expectedTender247 = totals.expectedTender247;
    }
    if (totals.readyForChatGpt !== undefined) {
      manifest.readyForChatGpt = totals.readyForChatGpt;
    }
    if (totals.selected !== undefined) {
      manifest.selected = totals.selected;
    }
  }
  manifest.updatedAt = new Date().toISOString();
  ensureDir(dateFolder);
  fs.writeFileSync(
    qualificationManifestPath(dateFolder),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  return manifest;
}

export function writeQualificationManifest(
  dateFolder: string,
  manifest: ChatGptQualificationManifest,
): void {
  recomputeManifestCounters(manifest);
  manifest.updatedAt = new Date().toISOString();
  ensureDir(dateFolder);
  fs.writeFileSync(
    qualificationManifestPath(dateFolder),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}

function recomputeManifestCounters(
  manifest: ChatGptQualificationManifest,
): void {
  let completed = 0;
  let skipped = 0;
  let notReady = 0;
  let pending = 0;
  let failed = 0;
  for (const entry of Object.values(manifest.tenders)) {
    switch (entry.status) {
      case "completed":
        completed += 1;
        break;
      case "skipped":
      case "already_complete":
        skipped += 1;
        break;
      case "not_ready":
        notReady += 1;
        break;
      case "response_pending":
      case "pending":
        pending += 1;
        break;
      case "failed":
        failed += 1;
        break;
      default:
        break;
    }
  }
  manifest.completed = completed;
  manifest.skipped = skipped;
  manifest.notReady = notReady;
  manifest.pending = pending;
  manifest.failed = failed;
}
