/**
 * Client-side tender list / status-summary cache (module scope).
 * Survives Tender Detail soft-nav remounts; cleared on explicit refresh / mutations.
 */

export type TenderListCachePayload = {
  rows: unknown[];
  total: number;
  page: number;
  pageSize: number;
};

export type CacheEntry<T> = {
  data: T;
  fetchedAt: number;
};

/** Show cached rows immediately; background-refresh after this age. */
export const TENDER_LIST_STALE_MS = 45_000;
/** Drop unused entries after this age. */
export const TENDER_LIST_GC_MS = 10 * 60_000;
const CACHE_LIMIT = 32;

const listCache = new Map<string, CacheEntry<TenderListCachePayload>>();
const summaryCache = new Map<string, CacheEntry<unknown>>();
const totalsByFilterKey = new Map<string, number>();

let mutationEpoch = 0;

function prune<T>(map: Map<string, CacheEntry<T>>) {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now - entry.fetchedAt > TENDER_LIST_GC_MS) map.delete(key);
  }
  while (map.size > CACHE_LIMIT) {
    const first = map.keys().next().value;
    if (typeof first !== "string") break;
    map.delete(first);
  }
}

export function getTenderListMutationEpoch(): number {
  return mutationEpoch;
}

/** Call after create / import / status edit / delete so list must revalidate. */
export function invalidateTenderListCaches(reason?: string): void {
  mutationEpoch += 1;
  listCache.clear();
  summaryCache.clear();
  totalsByFilterKey.clear();
  if (process.env.NODE_ENV === "development") {
    console.debug("[TenderQuery] invalidate", reason || "mutation", {
      epoch: mutationEpoch,
    });
  }
}

export function filterKeyWithoutPage(queryKey: string): string {
  const params = new URLSearchParams(queryKey);
  params.delete("page");
  params.delete("includeCount");
  return params.toString();
}

export function getCachedTenderList(
  queryKey: string,
): CacheEntry<TenderListCachePayload> | null {
  prune(listCache);
  return listCache.get(queryKey) ?? null;
}

export function setCachedTenderList(
  queryKey: string,
  data: TenderListCachePayload,
): void {
  listCache.set(queryKey, { data, fetchedAt: Date.now() });
  prune(listCache);
  if (data.total >= 0) {
    totalsByFilterKey.set(filterKeyWithoutPage(queryKey), data.total);
  }
}

export function getCachedListTotal(listFilterKey: string): number | undefined {
  return totalsByFilterKey.get(listFilterKey);
}

export function setCachedListTotal(listFilterKey: string, total: number): void {
  if (total >= 0) totalsByFilterKey.set(listFilterKey, total);
}

export function getCachedTenderSummary<T>(
  key: string,
): CacheEntry<T> | null {
  prune(summaryCache);
  const entry = summaryCache.get(key);
  return (entry as CacheEntry<T> | undefined) ?? null;
}

export function setCachedTenderSummary<T>(key: string, data: T): void {
  summaryCache.set(key, { data, fetchedAt: Date.now() });
  prune(summaryCache);
}

export function isCacheFresh(fetchedAt: number, staleMs = TENDER_LIST_STALE_MS): boolean {
  return Date.now() - fetchedAt < staleMs;
}
