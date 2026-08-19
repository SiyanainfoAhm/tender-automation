"use client";

import Link from "next/link";
import { Download } from "lucide-react";

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
    "Created",
    "Closing",
    "Value",
    "EMD",
    "Match",
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
      r.created_at ?? "",
      r.closing_date ?? "",
      `"${value.replace(/"/g, '""')}"`,
      `"${emd.replace(/"/g, '""')}"`,
      r.confidence ?? "",
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
  rows?: WebTenderListRow[];
  page?: number;
};

export function TenderPageActions({
  canImport,
  rows = [],
  page = 1,
}: TenderPageActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {rows.length > 0 ? (
        <Button
          type="button"
          variant="secondary"
          className="text-sm"
          onClick={() =>
            exportTenderRowsCsv(rows, `tenders-page-${page}.csv`)
          }
        >
          <Download className="size-4" />
          Export
        </Button>
      ) : null}
      {canImport ? (
        <Button asChild className="text-sm">
          <Link href="/tenders/import">Import Tenders</Link>
        </Button>
      ) : null}
    </div>
  );
}
