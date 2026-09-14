"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  peekTendersListReturn,
  TENDERS_LIST_RETURN_CHANGED_EVENT,
} from "@/lib/tenders/list-return";

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(TENDERS_LIST_RETURN_CHANGED_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(TENDERS_LIST_RETURN_CHANGED_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getClientSnapshot() {
  return peekTendersListReturn() || "/tenders";
}

function getServerSnapshot() {
  return "/tenders";
}

/**
 * Hydration-safe return href for sidebar / back links.
 * Server + hydrate paint always `/tenders`; client then adopts sessionStorage.
 * Re-reads on route changes so filters survive detail / workspace navigation.
 */
export function useTendersListReturnHref(): string {
  const pathname = usePathname();
  const storeHref = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const [href, setHref] = useState(storeHref);

  useEffect(() => {
    setHref(peekTendersListReturn() || "/tenders");
  }, [pathname, storeHref]);

  return href;
}
