"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowLeft } from "lucide-react";

import { peekTendersListReturn } from "@/lib/tenders/list-return";

function subscribe() {
  return () => {};
}

function getClientReturnHref() {
  return peekTendersListReturn() || "/tenders";
}

function getServerReturnHref() {
  return "/tenders";
}

/**
 * Returns to the preserved Tender Management URL (filters/page intact).
 * Falls back to /tenders when no safe return path was stored.
 */
export function TendersBackLink() {
  const href = useSyncExternalStore(
    subscribe,
    getClientReturnHref,
    getServerReturnHref,
  );

  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground-900"
    >
      <ArrowLeft className="size-4" />
      Tenders
    </Link>
  );
}
