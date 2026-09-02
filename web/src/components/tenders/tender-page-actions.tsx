"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Plus } from "lucide-react";

import { AddManualTenderModal } from "@/components/tenders/add-manual-tender-modal";
import { Button } from "@/components/ui/button";
import {
  buildTenderPageExportFilename,
  downloadTenderExportXlsx,
} from "@/lib/tender-export";
import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

export { downloadTenderExportXlsx as exportTenderRowsCsv } from "@/lib/tender-export";

type TenderPageActionsProps = {
  canImport: boolean;
  canCreate?: boolean;
  rows?: WebTenderListRow[];
  page?: number;
  disabled?: boolean;
  onCreated?: () => void;
};

export function TenderPageActions({
  canImport,
  canCreate = false,
  rows = [],
  page = 1,
  disabled = false,
  onCreated,
}: TenderPageActionsProps) {
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {rows.length > 0 ? (
        <Button
          type="button"
          variant="secondary"
          className="text-sm"
          disabled={disabled}
          onClick={() =>
            void downloadTenderExportXlsx(
              rows,
              buildTenderPageExportFilename(page),
            )
          }
        >
          <Download className="size-4" />
          Export
        </Button>
      ) : null}
      {canCreate ? (
        <Button
          type="button"
          variant="secondary"
          className="text-sm"
          disabled={disabled}
          onClick={() => setManualOpen(true)}
        >
          <Plus className="size-4" />
          Add Manual Tender
        </Button>
      ) : null}
      {canImport ? (
        <Button asChild={!disabled} className="text-sm" disabled={disabled}>
          {disabled ? (
            "Import Tenders"
          ) : (
            <Link href="/tenders/import">Import Tenders</Link>
          )}
        </Button>
      ) : null}

      <AddManualTenderModal
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={() => onCreated?.()}
      />
    </div>
  );
}
