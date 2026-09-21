"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  detailOriginLabel,
  peekTenderDetailOrigin,
  TENDERS_LIST_RETURN_CHANGED_EVENT,
} from "@/lib/tenders/list-return";
import {
  useTendersListReturnHref,
  type TendersListRegionFallback,
} from "@/lib/tenders/use-tenders-list-return-href";

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(TENDERS_LIST_RETURN_CHANGED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener(
      TENDERS_LIST_RETURN_CHANGED_EVENT,
      onStoreChange,
    );
  };
}

/**
 * Returns to the surface that opened the tender (Indian/Global list or
 * Submitted Tenders). Falls back to the preserved tender list URL.
 */
export function TendersBackLink(props?: {
  fallbackRegion?: TendersListRegionFallback;
}) {
  const listHref = useTendersListReturnHref(props?.fallbackRegion);
  const origin = useSyncExternalStore(
    subscribe,
    peekTenderDetailOrigin,
    () => null,
  );
  const href = origin || listHref;

  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground-900"
    >
      <ArrowLeft className="size-4" />
      {detailOriginLabel(href)}
    </Link>
  );
}
