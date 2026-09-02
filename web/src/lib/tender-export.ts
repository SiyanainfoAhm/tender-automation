import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

export {
  buildTenderExportAllFilename,
  buildTenderExportFilename,
  buildTenderPageExportFilename,
  buildTenderSelectedExportFilename,
  exportDateStamp,
  exportMoneyCellValue,
  formatExemptionExport,
  tenderExportReason,
  tenderExportStatusLabel,
  toExcelDate,
  TENDER_EXPORT_COLUMN_HEADERS,
} from "./tender-export-utils";

/** @deprecated Use TENDER_EXPORT_COLUMN_HEADERS */
export { TENDER_EXPORT_COLUMN_HEADERS as TENDER_EXPORT_HEADERS } from "./tender-export-utils";

export async function downloadTenderExportXlsx(
  rows: WebTenderListRow[],
  filename: string,
): Promise<void> {
  const { buildTenderExportWorkbookBuffer } = await import(
    "./tender-export-xlsx"
  );
  const buffer = await buildTenderExportWorkbookBuffer(rows);

  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportAllFilteredTenders(
  queryString: string,
): Promise<{ exported: number }> {
  const response = await fetch(
    `/api/tenders/export${queryString ? `?${queryString}` : ""}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    let message = "Unable to export tenders.";
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const data = (await response.json()) as {
    rows: WebTenderListRow[];
    total: number;
  };
  const { buildTenderExportAllFilename } = await import("./tender-export-utils");
  await downloadTenderExportXlsx(data.rows, buildTenderExportAllFilename());
  return { exported: data.total };
}
