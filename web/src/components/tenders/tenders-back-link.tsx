"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { useTendersListReturnHref } from "@/lib/tenders/use-tenders-list-return-href";

/**
 * Returns to the preserved Tender Management URL (filters/page intact).
 * Falls back to /tenders when no safe return path was stored.
 */
export function TendersBackLink() {
  const href = useTendersListReturnHref();

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
