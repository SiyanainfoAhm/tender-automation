/**
 * Preserve Tender Management URL + scroll when leaving the list.
 * URL search params remain the source of truth for filters; this stores the
 * return path so Detail / Bid Workspace / sidebar Back do not wipe them
 * for the lifetime of the browser tab (sessionStorage).
 */

const RETURN_URL_KEY = "tenderflow:tenders-list-return";
const SCROLL_KEY = "tenderflow:tenders-list-scroll";

/** Only allow returning to the list route (never open redirects). */
export function isSafeTendersListReturnPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  const pathOnly = path.split("?")[0]?.split("#")[0] || "";
  // Exact list page — not /tenders/[id] or nested routes.
  return pathOnly === "/tenders";
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
  } catch {
    /* private mode / quota */
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
  if (pathname !== "/tenders") return "/tenders";
  return queryKey ? `/tenders?${queryKey}` : "/tenders";
}
