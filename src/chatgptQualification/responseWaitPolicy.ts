/**
 * Response-wait policy: stall = no activity, never refresh while generation is active.
 */

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
  return [
    snap.assistantCount,
    snap.textLength,
    snap.textFingerprint,
    snap.active ? "1" : "0",
    snap.generationLabel,
    snap.stopVisible ? "1" : "0",
  ].join("|");
}

/**
 * Update lastResponseActivityAt from snapshot deltas.
 * While generation is active, always treat as activity (even if DOM text is unchanged).
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
  if (next.active) {
    return { lastActivityAtMs: nowMs, changed: true, fingerprint };
  }
  const prevFp = fingerprintResponseActivity(previous);
  const changed = prevFp !== fingerprint;
  return {
    lastActivityAtMs: changed ? nowMs : lastActivityAtMs,
    changed,
    fingerprint,
  };
}

/**
 * Stall means no response activity/change for stallMs — NOT elapsed since Send.
 * Active generation never stalls.
 */
export function isResponseActivityStalled(options: {
  lastActivityAtMs: number;
  nowMs: number;
  stallMs: number;
  currentlyActive: boolean;
}): boolean {
  if (options.currentlyActive) return false;
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
  // Even when broken: caller must reopen exact /c/ URL — never project home mid-wait.
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
