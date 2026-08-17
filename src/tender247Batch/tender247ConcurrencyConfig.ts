/**
 * Tender247 / ChatGPT concurrency.
 * Selected-tender artifact acquisition is forced to 1 regardless of older env vars.
 */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

export type Tender247ConcurrencyConfig = {
  detailConcurrency: number;
  downloadConcurrency: number;
  artifactConcurrency: number;
  metadataConcurrency: number;
  prescreenConcurrency: number;
  chatgptConcurrency: number;
  chatgptReadyQueueMax: number;
  chatgptMinSubmissionIntervalMs: number;
  chatgptRateLimitBackoffMs: number;
  chatgptMaxRateLimitBackoffMs: number;
  documentDownloadTimeoutMs: number;
};

const ARTIFACT_CONCURRENCY = 1;

export function getTender247DocumentDownloadTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = parsePositiveInt(env.TENDER247_DOCUMENT_DOWNLOAD_TIMEOUT_MS, 300_000);
  return Math.max(30_000, n);
}

export function loadTender247ConcurrencyConfig(
  env: NodeJS.ProcessEnv = process.env,
): Tender247ConcurrencyConfig {
  const requestedDetail = parsePositiveInt(env.TENDER247_DETAIL_CONCURRENCY, 1);
  const requestedDownload = parsePositiveInt(
    env.TENDER247_DOWNLOAD_CONCURRENCY,
    1,
  );
  const requestedArtifact = parsePositiveInt(
    env.TENDER247_ARTIFACT_CONCURRENCY,
    1,
  );
  void requestedDetail;
  void requestedDownload;
  void requestedArtifact;
  const chatgptConcurrency = Math.min(
    2,
    parsePositiveInt(env.CHATGPT_CONCURRENCY, 1),
  );
  return {
    detailConcurrency: ARTIFACT_CONCURRENCY,
    downloadConcurrency: ARTIFACT_CONCURRENCY,
    artifactConcurrency: ARTIFACT_CONCURRENCY,
    metadataConcurrency: ARTIFACT_CONCURRENCY,
    prescreenConcurrency: parsePositiveInt(env.PRESCREEN_CONCURRENCY, 4),
    chatgptConcurrency,
    chatgptReadyQueueMax: parsePositiveInt(env.CHATGPT_READY_QUEUE_MAX, 10),
    chatgptMinSubmissionIntervalMs: parsePositiveInt(
      env.CHATGPT_MIN_SUBMISSION_INTERVAL_MS,
      300_000,
    ),
    chatgptRateLimitBackoffMs: parsePositiveInt(
      env.CHATGPT_RATE_LIMIT_BACKOFF_MS,
      300_000,
    ),
    chatgptMaxRateLimitBackoffMs: parsePositiveInt(
      env.CHATGPT_MAX_RATE_LIMIT_BACKOFF_MS,
      600_000,
    ),
    documentDownloadTimeoutMs: getTender247DocumentDownloadTimeoutMs(env),
  };
}
