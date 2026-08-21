"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Plus } from "lucide-react";

import { AddManualTenderModal } from "@/components/tenders/add-manual-tender-modal";
import { Button } from "@/components/ui/button";
import { formatEmdAmount, formatTenderValue } from "@/lib/format-inr";
import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

function downloadCsv(rows: WebTenderListRow[], filename: string) {
  const headers = [
    "Title",
    "Source",
    "Reference",
    "Organization",
    "Category",
    "Status",
    "Scraped Date",
    "Created At",
    "Closing",
    "Value",
    "EMD",
    "Tender ID",
  ];
  const csvRows = rows.map((r) => {
    const value = formatTenderValue({
      amount: r.tender_value,
      text: r.tender_value_text,
    }).label;
    const emd = formatEmdAmount({
      amount: r.emd_amount,
      text: r.emd_text,
    }).label;
    return [
      `"${(r.title || "").replace(/"/g, '""')}"`,
      r.source_portal,
      `"${(r.folder_id || r.source_tender_id || "").replace(/"/g, '""')}"`,
      `"${(r.organization || "").replace(/"/g, '""')}"`,
      `"${(r.project_category || "").replace(/"/g, '""')}"`,
      r.effective_qualification_status ?? "NOT_EVALUATED",
      r.scraped_date ?? "",
      r.created_at ?? "",
      r.closing_date ?? "",
      `"${value.replace(/"/g, '""')}"`,
      `"${emd.replace(/"/g, '""')}"`,
      r.source_tender_id,
    ].join(",");
  });
  const blob = new Blob([[headers.join(","), ...csvRows].join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportTenderRowsCsv(
  rows: WebTenderListRow[],
  filename: string,
) {
  downloadCsv(rows, filename);
}

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
            exportTenderRowsCsv(rows, `tenders-page-${page}.csv`)
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
