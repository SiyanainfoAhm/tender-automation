/**
 * Tender247 / ChatGPT concurrency defaults (env-overridable).
 */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

export type Tender247ConcurrencyConfig = {
  detailConcurrency: number;
  downloadConcurrency: number;
  metadataConcurrency: number;
  prescreenConcurrency: number;
  chatgptConcurrency: number;
  chatgptReadyQueueMax: number;
  chatgptMinSubmissionIntervalMs: number;
  chatgptRateLimitBackoffMs: number;
  chatgptMaxRateLimitBackoffMs: number;
};

export function loadTender247ConcurrencyConfig(
  env: NodeJS.ProcessEnv = process.env,
): Tender247ConcurrencyConfig {
  // Default 1 until dual-worker transaction is proven stable; cap at 2.
  const chatgptConcurrency = Math.min(
    2,
    parsePositiveInt(env.CHATGPT_CONCURRENCY, 1),
  );
  return {
    detailConcurrency: parsePositiveInt(env.TENDER247_DETAIL_CONCURRENCY, 4),
    downloadConcurrency: parsePositiveInt(
      env.TENDER247_DOWNLOAD_CONCURRENCY,
      4,
    ),
    metadataConcurrency: parsePositiveInt(
      env.METADATA_EXTRACTION_CONCURRENCY,
      4,
    ),
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
  };
}
