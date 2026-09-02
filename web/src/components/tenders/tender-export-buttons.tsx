"use client";

import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  buildTenderPageExportFilename,
  downloadTenderExportXlsx,
  exportAllFilteredTenders,
} from "@/lib/tender-export";
import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

type TenderExportButtonsProps = {
  rows: WebTenderListRow[];
  total: number;
  page: number;
  exportingAll: boolean;
  disabled?: boolean;
  onExportAll: () => void;
  className?: string;
  size?: "sm" | "default";
};

export function TenderExportButtons({
  rows,
  total,
  page,
  exportingAll,
  disabled = false,
  onExportAll,
  className,
  size = "sm",
}: TenderExportButtonsProps) {
  const buttonClass = size === "sm" ? "h-8 text-sm" : "text-sm";
  const iconClass = size === "sm" ? "size-3.5" : "size-4";
  const busy = disabled || exportingAll;

  return (
    <div className={className ?? "flex items-center gap-2"}>
      <Button
        type="button"
        variant="secondary"
        className={buttonClass}
        disabled={busy || rows.length === 0}
        onClick={() =>
          void downloadTenderExportXlsx(
            rows,
            buildTenderPageExportFilename(page),
          )
        }
      >
        <Download className={iconClass} />
        Export Page
      </Button>
      <Button
        type="button"
        variant="secondary"
        className={buttonClass}
        disabled={busy || total === 0}
        onClick={onExportAll}
      >
        {exportingAll ? (
          <Loader2 className={`${iconClass} animate-spin`} />
        ) : (
          <Download className={iconClass} />
        )}
        {exportingAll ? "Exporting…" : "Export All"}
      </Button>
    </div>
  );
}

export { exportAllFilteredTenders };
