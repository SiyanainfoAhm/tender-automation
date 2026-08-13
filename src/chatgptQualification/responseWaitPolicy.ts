/**
 * Response-wait policy: stall = no *meaningful* activity.
 * Sticky Stop button alone is NOT activity and must not block JSON completion.
 */
import {
  isMeaningfulResponseActivityChange,
} from "./canonicalJsonCompletion.js";

export type ResponseActivitySnapshot = {
  assistantCount: number;
  textLength: number;
  textFingerprint: string;
  active: boolean;
  generationLabel: string;
  stopVisible: boolean;
};

export function fingerprintResponseActivity(
  snap: ResponseActivitySnapshot,
): string {
  // Fingerprint excludes stopVisible — sticky Stop must not look like change.
  return [
    snap.assistantCount,
    snap.textLength,
    snap.textFingerprint,
    snap.generationLabel,
  ].join("|");
}

/**
 * Update lastResponseActivityAt only on meaningful deltas:
 * assistant count, text hash/length, Thinking/Search/label transitions.
 * Sticky Stop / active=true with unchanged text does NOT bump activity.
 */
export function updateLastResponseActivityAt(options: {
  previous: ResponseActivitySnapshot | null;
  next: ResponseActivitySnapshot;
  lastActivityAtMs: number;
  nowMs: number;
}): { lastActivityAtMs: number; changed: boolean; fingerprint: string } {
  const { previous, next, lastActivityAtMs, nowMs } = options;
  const fingerprint = fingerprintResponseActivity(next);
  if (!previous) {
    return { lastActivityAtMs: nowMs, changed: true, fingerprint };
  }

  const meaningful = isMeaningfulResponseActivityChange({
    previousAssistantCount: previous.assistantCount,
    nextAssistantCount: next.assistantCount,
    previousTextHash: previous.textFingerprint,
    nextTextHash: next.textFingerprint,
    previousTextLength: previous.textLength,
    nextTextLength: next.textLength,
    previousGenerationLabel: previous.generationLabel,
    nextGenerationLabel: next.generationLabel,
  });

  return {
    lastActivityAtMs: meaningful ? nowMs : lastActivityAtMs,
    changed: meaningful,
    fingerprint,
  };
}

/**
 * Stall means no meaningful response activity for stallMs.
 * Active generation with *changing* text is handled via activity bumps.
 * Sticky Stop alone does NOT prevent stall detection (JSON fast-path owns completion).
 */
export function isResponseActivityStalled(options: {
  lastActivityAtMs: number;
  nowMs: number;
  stallMs: number;
  currentlyActive: boolean;
  /** When true, sticky Stop alone does not block stall. */
  ignoreStickyActive?: boolean;
}): boolean {
  // Legacy: active generation blocked stall. New default: only block when
  // caller says generation is meaningfully active (text still changing).
  if (options.currentlyActive && options.ignoreStickyActive !== true) {
    // Keep prior semantics for callers that still pass currentlyActive=true
    // only when generation is truly live — wait loop should pass
    // currentlyActive=false when only Stop is sticky with unchanged text.
    return false;
  }
  return options.nowMs - options.lastActivityAtMs >= options.stallMs;
}

/**
 * Hard rule: never refresh/reload/project-reopen while waiting for a normal response.
 * Refresh is last-resort only when the page is clearly broken AND conversation URL is known.
 */
export function mayNavigateAwayDuringResponseWait(options: {
  promptSubmitted: boolean;
  conversationUrlValid: boolean;
  responseActive: boolean;
  responseComplete: boolean;
  pageBroken: boolean;
}): boolean {
  if (options.responseComplete) return true;
  if (!options.promptSubmitted) return false;
  if (options.responseActive) return false;
  if (options.conversationUrlValid && !options.pageBroken) return false;
  return false;
}

export function getResponseStallTimeoutMsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number.parseInt(
    env.CHATGPT_RESPONSE_STALL_TIMEOUT_MS || "300000",
    10,
  );
  return Number.isFinite(n) && n >= 10_000 ? n : 300_000;
}
