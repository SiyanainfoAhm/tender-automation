"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import {
  useTendersListReturnHref,
  type TendersListRegionFallback,
} from "@/lib/tenders/use-tenders-list-return-href";

/**
 * Returns to the preserved Tender Management URL (filters/page intact).
 * Falls back to /tenders/indian or /tenders/global from the open tender region.
 */
export function TendersBackLink(props?: {
  fallbackRegion?: TendersListRegionFallback;
}) {
  const href = useTendersListReturnHref(props?.fallbackRegion);

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
