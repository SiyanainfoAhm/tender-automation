/**
 * Preserve Tender Management URL + scroll when leaving the list.
 * URL search params remain the source of truth for filters; this stores the
 * return path so Detail / Bid Workspace / sidebar Back do not wipe them
 * for the lifetime of the browser tab (sessionStorage).
 */

const RETURN_URL_KEY = "tenderflow:tenders-list-return";
const SCROLL_KEY = "tenderflow:tenders-list-scroll";
/** Last surface that opened a tender detail (list or submitted tenders). */
const DETAIL_ORIGIN_KEY = "tenderflow:tender-detail-origin";
export const TENDERS_LIST_RETURN_CHANGED_EVENT =
  "tenderflow:tenders-list-return";

const SAFE_TENDERS_LIST_PATHS = new Set([
  "/tenders",
  "/tenders/indian",
  "/tenders/global",
]);

const SAFE_DETAIL_ORIGIN_PATHS = new Set([
  ...SAFE_TENDERS_LIST_PATHS,
  "/submitted-tenders",
]);

function isSafeAppPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  return true;
}

function pathOnly(path: string): string {
  return path.split("?")[0]?.split("#")[0] || "";
}

/** Only allow returning to the list route (never open redirects). */
export function isSafeTendersListReturnPath(path: string): boolean {
  if (!isSafeAppPath(path)) return false;
  // Exact list pages — not /tenders/[id] or import/workspace.
  return SAFE_TENDERS_LIST_PATHS.has(pathOnly(path));
}

/** List pages plus Submitted Tenders — used by detail / workspace Back. */
export function isSafeTenderDetailOriginPath(path: string): boolean {
  if (!isSafeAppPath(path)) return false;
  return SAFE_DETAIL_ORIGIN_PATHS.has(pathOnly(path));
}

export function detailOriginLabel(path: string | null | undefined): string {
  if (path && pathOnly(path) === "/submitted-tenders") {
    return "Submitted Tenders";
  }
  return "Tenders";
}

function notifyReturnChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TENDERS_LIST_RETURN_CHANGED_EVENT));
}

export function rememberTendersListReturn(
  href: string,
  scrollY?: number,
): void {
  if (typeof window === "undefined") return;
  if (!isSafeTendersListReturnPath(href)) return;
  try {
    sessionStorage.setItem(RETURN_URL_KEY, href);
    if (typeof scrollY === "number" && Number.isFinite(scrollY)) {
      sessionStorage.setItem(SCROLL_KEY, String(Math.max(0, Math.round(scrollY))));
    }
    notifyReturnChanged();
  } catch {
    /* private mode / quota */
  }
}

/** Persist current list filters without touching scroll (filter changes). */
export function rememberTendersListFilters(href: string): void {
  if (typeof window === "undefined") return;
  if (!isSafeTendersListReturnPath(href)) return;
  try {
    sessionStorage.setItem(RETURN_URL_KEY, href);
    notifyReturnChanged();
  } catch {
    /* private mode / quota */
  }
}

/** Where Back on tender detail / bid workspace should go. */
export function rememberTenderDetailOrigin(href: string): void {
  if (typeof window === "undefined") return;
  if (!isSafeTenderDetailOriginPath(href)) return;
  try {
    sessionStorage.setItem(DETAIL_ORIGIN_KEY, href);
    notifyReturnChanged();
  } catch {
    /* private mode / quota */
  }
}

export function peekTenderDetailOrigin(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = sessionStorage.getItem(DETAIL_ORIGIN_KEY);
    if (!value || !isSafeTenderDetailOriginPath(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function peekTendersListReturn(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = sessionStorage.getItem(RETURN_URL_KEY);
    if (!value || !isSafeTendersListReturnPath(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function consumeTendersListScroll(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    sessionStorage.removeItem(SCROLL_KEY);
    if (raw == null) return null;
    const y = Number(raw);
    return Number.isFinite(y) && y >= 0 ? y : null;
  } catch {
    return null;
  }
}

export function tendersListHrefFromParts(
  pathname: string,
  queryKey: string,
): string {
  const base = SAFE_TENDERS_LIST_PATHS.has(pathname)
    ? pathname
    : "/tenders/indian";
  return queryKey ? `${base}?${queryKey}` : base;
}
