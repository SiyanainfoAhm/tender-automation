/**
 * Production crawl / ChatGPT limit semantics.
 *
 * For MAX_TENDERS, MAX_BIDASSIST_TENDERS, and MAX_GPT_TENDERS:
 * - 0 (or negative after clamp) means UNLIMITED — never "process zero rows"
 * - positive N means at most N
 */

/** True when the configured limit means "no cap". */
export function isUnlimitedProductionLimit(limit: number): boolean {
  return !Number.isFinite(limit) || limit <= 0;
}

/**
 * Resolve a configured max into an effective numeric cap.
 * Unlimited → Number.POSITIVE_INFINITY.
 */
export function resolveProductionLimit(limit: number): number {
  if (isUnlimitedProductionLimit(limit)) {
    return Number.POSITIVE_INFINITY;
  }
  return limit;
}

/** Startup / log label: UNLIMITED or the positive integer. */
export function formatProductionLimit(limit: number): string {
  return isUnlimitedProductionLimit(limit) ? "UNLIMITED" : String(limit);
}

/**
 * Cap for selectPassedForChatgpt / ChatGPT queues.
 * Unlimited → undefined (caller must not treat as zero).
 */
export function chatgptSelectionLimit(
  maxGptTenders: number,
): number | undefined {
  return isUnlimitedProductionLimit(maxGptTenders)
    ? undefined
    : maxGptTenders;
}

/** Apply a production crawl cap to a list (0 = no slice). */
export function applyProductionLimitCap<T>(items: T[], limit: number): T[] {
  const resolved = resolveProductionLimit(limit);
  if (!Number.isFinite(resolved)) {
    return items;
  }
  if (items.length <= resolved) {
    return items;
  }
  return items.slice(0, resolved);
}
