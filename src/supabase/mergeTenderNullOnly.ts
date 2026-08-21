/**
 * Null-only merge for tender rows: GPT Excel is SoT for screening status;
 * crawl/enrichment only fills empty fields.
 */

export function isBlankDbValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

/**
 * Merge `incoming` into `existing`.
 * - Always apply keys listed in `alwaysUpdate`
 * - For other keys, only copy when existing is blank
 */
export function mergeNullOnlyRecord<T extends Record<string, unknown>>(
  existing: T | null | undefined,
  incoming: Partial<T>,
  alwaysUpdate: ReadonlyArray<keyof T> = [],
): { next: Partial<T>; updatedKeys: string[] } {
  const always = new Set(alwaysUpdate.map(String));
  const next: Partial<T> = {};
  const updatedKeys: string[] = [];

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const prior = existing ? existing[key as keyof T] : undefined;
    if (always.has(key) || !existing || isBlankDbValue(prior)) {
      if (existing && Object.is(prior, value)) continue;
      if (
        typeof prior === "string" &&
        typeof value === "string" &&
        prior.trim() === value.trim()
      ) {
        continue;
      }
      (next as Record<string, unknown>)[key] = value;
      updatedKeys.push(key);
    }
  }

  return { next, updatedKeys };
}
