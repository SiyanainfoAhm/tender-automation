import type { Tender247ExpectedManifest } from "./tender247AttachmentManifest.js";
import {
  validateDisplayedAttachmentNames,
  type DisplayedAttachmentValidation,
} from "./tender247AttachmentManifest.js";

export const STABLE_ATTACHMENT_POLLS_REQUIRED = 2;
export const STABLE_ATTACHMENT_POLL_MS = 900;
export const MAX_UPLOAD_ATTEMPTS = 2;

export type TenderAttachmentUploadState = {
  uploadAttempt: number;
  filesAssigned: boolean;
  attachmentsLocked: boolean;
};

export function createTenderAttachmentUploadState(): TenderAttachmentUploadState {
  return {
    uploadAttempt: 0,
    filesAssigned: false,
    attachmentsLocked: false,
  };
}

export function canAssignUploadFiles(state: TenderAttachmentUploadState): boolean {
  return !state.attachmentsLocked && !state.filesAssigned;
}

export function lockAttachments(state: TenderAttachmentUploadState): void {
  state.attachmentsLocked = true;
}

export type StabilityPollInput = {
  composerCount: number;
  /** Authoritative logical count when provided (preferred over composerCount). */
  logicalAttachmentCount?: number;
  displayedNames: string[];
  manifest: Tender247ExpectedManifest;
  previousStableCount: number | null;
  consecutiveStablePolls: number;
};

export type StabilityPollResult = {
  validation: DisplayedAttachmentValidation;
  consecutiveStablePolls: number;
  stable: boolean;
};

/** Two consecutive composer polls with complete logical file validation. */
export function evaluateAttachmentStabilityPoll(
  input: StabilityPollInput,
): StabilityPollResult {
  const validation = validateDisplayedAttachmentNames({
    manifest: input.manifest,
    displayedNames: input.displayedNames,
  });

  const authoritativeCount =
    input.logicalAttachmentCount ?? input.composerCount;

  let consecutiveStablePolls = 0;
  if (
    validation.ok &&
    authoritativeCount === input.manifest.expectedCount
  ) {
    if (input.previousStableCount === authoritativeCount) {
      consecutiveStablePolls = input.consecutiveStablePolls + 1;
    } else {
      consecutiveStablePolls = 1;
    }
  }

  return {
    validation,
    consecutiveStablePolls,
    stable: consecutiveStablePolls >= STABLE_ATTACHMENT_POLLS_REQUIRED,
  };
}

export type RealUploadFailureReason =
  | "upload_limit_warning"
  | "upload_error_visible"
  | "duplicate_logical_type"
  | "timeout"
  | "composer_not_clean"
  | "composer_detached"
  | "none";

export function classifyRealUploadFailure(options: {
  uploadLimitWarning: boolean;
  uploadErrorVisible: boolean;
  validation: DisplayedAttachmentValidation;
  timedOut: boolean;
  composerDetached?: boolean;
}): RealUploadFailureReason {
  if (options.uploadLimitWarning) {
    return "upload_limit_warning";
  }
  if (options.uploadErrorVisible) {
    return "upload_error_visible";
  }
  if (options.composerDetached) {
    return "composer_detached";
  }
  if (
    options.validation.failureReason === "duplicate_metadata" ||
    options.validation.failureReason === "duplicate_ai_summary" ||
    options.validation.failureReason === "duplicate_archive"
  ) {
    return "duplicate_logical_type";
  }
  if (options.timedOut) {
    return "timeout";
  }
  return "none";
}

export function shouldRetryUpload(
  attempt: number,
  failure: RealUploadFailureReason,
): boolean {
  if (failure === "none") {
    return false;
  }
  return attempt < MAX_UPLOAD_ATTEMPTS;
}
