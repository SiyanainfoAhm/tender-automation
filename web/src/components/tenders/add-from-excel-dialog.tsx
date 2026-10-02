"use client";

import { useRef, useState, useTransition } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invalidateTenderListCaches } from "@/lib/tenders/list-cache";
import { importTendersFromExcelAction } from "@/server/actions/tender-excel-import";

function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.onload = () => {
      const data = String(reader.result || "");
      resolve(data.slice(data.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

type AddFromExcelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
};

export function AddFromExcelDialog({ open, onOpenChange, onImported }: AddFromExcelDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [scrapedDate, setScrapedDate] = useState(todayInIndia);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function close(nextOpen: boolean) {
    if (!isPending) onOpenChange(nextOpen);
  }

  function submit() {
    if (!file || isPending) return;
    setError(null);
    setSummary(null);
    startTransition(async () => {
      try {
        const response = await importTendersFromExcelAction({
          fileName: file.name,
          fileBase64: await fileToBase64(file),
          scrapedDate,
        });
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setSummary(`Upserted ${response.upserted} tender${response.upserted === 1 ? "" : "s"} from ${response.sheets} sheet${response.sheets === 1 ? "" : "s"}.${response.skipped ? ` Skipped ${response.skipped} incomplete row${response.skipped === 1 ? "" : "s"}.` : ""}`);
        invalidateTenderListCaches("tender-excel-import");
        onImported?.();
      } catch {
        setError("The selected file could not be read. Please try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add tenders from Excel</DialogTitle>
          <DialogDescription>
            Upload a Tender247 workbook and select the date it was scraped. Rows are upserted by Tender247 ID and scraped date.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tender-excel-file">Excel file</Label>
            <Input
              ref={fileRef}
              id="tender-excel-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={isPending}
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setError(null);
                setSummary(null);
              }}
            />
            <p className="text-xs text-foreground-500">
              Requires <span className="font-medium">T247 ID</span> and <span className="font-medium">Tender Brief</span>. Reference number, organisation, dates, values, EMD, location, checklist, and other available columns are retained.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tender-excel-scraped-date">Scraped date</Label>
            <Input
              id="tender-excel-scraped-date"
              type="date"
              value={scrapedDate}
              max="9999-12-31"
              disabled={isPending}
              onChange={(event) => setScrapedDate(event.target.value)}
            />
          </div>
          {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          {summary ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{summary}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={isPending} onClick={() => close(false)}>Close</Button>
          <Button type="button" disabled={!file || !scrapedDate || isPending} onClick={submit}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
            Upsert tenders
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
