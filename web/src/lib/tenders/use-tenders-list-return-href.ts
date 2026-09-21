"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  peekTendersListReturn,
  TENDERS_LIST_RETURN_CHANGED_EVENT,
} from "@/lib/tenders/list-return";

export type TendersListRegionFallback = "INDIAN" | "GLOBAL" | null | undefined;

function defaultHrefForRegion(region?: TendersListRegionFallback): string {
  return region === "GLOBAL" ? "/tenders/global" : "/tenders/indian";
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(TENDERS_LIST_RETURN_CHANGED_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(TENDERS_LIST_RETURN_CHANGED_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getClientSnapshot(region?: TendersListRegionFallback) {
  return peekTendersListReturn() || defaultHrefForRegion(region);
}

function getServerSnapshot(region?: TendersListRegionFallback) {
  return defaultHrefForRegion(region);
}

/**
 * Hydration-safe return href for sidebar / back links.
 * Prefers sessionStorage (filters intact). Falls back to Indian or Global list
 * based on the open tender's source_region so Global detail Back doesn't land
 * on /tenders/indian.
 */
export function useTendersListReturnHref(
  fallbackRegion?: TendersListRegionFallback,
): string {
  const pathname = usePathname();
  const storeHref = useSyncExternalStore(
    subscribe,
    () => getClientSnapshot(fallbackRegion),
    () => getServerSnapshot(fallbackRegion),
  );
  const [href, setHref] = useState(storeHref);

  useEffect(() => {
    setHref(peekTendersListReturn() || defaultHrefForRegion(fallbackRegion));
  }, [pathname, storeHref, fallbackRegion]);

  return href;
}
