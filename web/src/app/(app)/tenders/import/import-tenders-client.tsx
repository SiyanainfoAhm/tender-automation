"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  PlugZap,
} from "lucide-react";

import { CategoryCapsule } from "@/components/tenders/category-capsule";
import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmImportTendersAction,
  previewImportTendersAction,
} from "@/server/actions/tender-import";
import type {
  ImportHistoryRow,
  ImportPortal,
  ImportPreviewRow,
  ImportSourceSummary,
} from "@/lib/tender-import";
import { formatDate } from "@/lib/format";
import { formatTenderValue } from "@/lib/format-inr";
import { cn } from "@/lib/utils";

const STEPS = [
  "Select Source",
  "Configure Filters",
  "Preview Tenders",
  "Import",
  "Done",
] as const;

type ImportTendersClientProps = {
  sources: ImportSourceSummary[];
  history: ImportHistoryRow[];
};

export function ImportTendersClient({
  sources,
  history,
}: ImportTendersClientProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<ImportPortal | null>(
    sources.find((item) => item.connected)?.source ?? null,
  );
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [minDays, setMinDays] = useState("");
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    newAdded: number;
    duplicates: number;
    failed: number;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedSource = sources.find((item) => item.source === source) ?? null;
  const selectedCount = selectedIds.size;
  const newCandidates = useMemo(
    () => previewRows.filter((row) => !row.isDuplicate),
    [previewRows],
  );

  function resetWizard() {
    setStep(0);
    setPreviewRows([]);
    setPreviewTotal(0);
    setSelectedIds(new Set());
    setResult(null);
    setError(null);
  }

  function loadPreview() {
    if (!source) return;
    setError(null);
    startTransition(async () => {
      const response = await previewImportTendersAction({
        source,
        keywords,
        location,
        minValue,
        maxValue,
        minDaysToDeadline: minDays,
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setPreviewRows(response.rows);
      setPreviewTotal(response.total);
      setSelectedIds(
        new Set(response.rows.filter((row) => !row.isDuplicate).map((row) => row.id)),
      );
      setStep(2);
    });
  }

  function runImport() {
    if (selectedCount === 0 || isPending) return;
    setError(null);
    setStep(3);
    startTransition(async () => {
      const response = await confirmImportTendersAction([...selectedIds]);
      if (!response.ok) {
        setError(response.error);
        setStep(2);
        return;
      }
      setResult({
        newAdded: response.newAdded,
        duplicates: response.duplicates,
        failed: response.failed,
      });
      setStep(4);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="section-title">Import Tenders</h1>
          <p className="mt-0.5 text-sm text-foreground-500">
            Review crawler-ingested tenders from your connected portals
          </p>
        </div>
        <Button asChild variant="secondary" className="text-sm">
          <Link href="/tenders">Back to pipeline</Link>
        </Button>
      </div>

      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
              index === step
                ? "bg-primary-500 text-white"
                : index < step
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-background-100 text-foreground-500",
            )}
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {step === 0 ? (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            {sources.map((item) => (
              <button
                key={item.source}
                type="button"
                onClick={() => setSource(item.source)}
                className={cn(
                  "rounded-lg border bg-card p-5 text-left shadow-sm transition-colors",
                  source === item.source
                    ? "border-primary-500 ring-1 ring-primary-500"
                    : "border-border hover:border-background-500",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <SourceBadge
                    source={item.source as TenderSource}
                    size="sm"
                    className="rounded px-1.5 py-0.5 normal-case tracking-normal"
                  />
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      item.connected
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-background-200 text-foreground-500",
                    )}
                  >
                    {item.connected ? "Connected" : "No data yet"}
                  </span>
                </div>
                <h2 className="mt-3 text-sm font-semibold text-foreground-900">
                  {item.name}
                </h2>
                <p className="mt-1 text-xs leading-5 text-foreground-500">
                  {item.description}
                </p>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-500">
                  <span>Last sync: {item.lastSyncLabel}</span>
                  <span>
                    In pipeline: {item.tenderCount.toLocaleString("en-IN")}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="border-b border-background-200/70 px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground-800">
                Recent imports
              </h2>
              <p className="text-xs text-foreground-500">
                Derived from crawler first-seen / last-seen dates. There is no
                separate import-jobs table.
              </p>
            </div>
            {history.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-foreground-500">
                No ingestion activity in the last 14 days.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b border-background-200/70 bg-background-50 text-left text-xs font-semibold uppercase tracking-wider text-foreground-500">
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">New</th>
                      <th className="px-4 py-3">Duplicates</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-background-200/70 last:border-0"
                      >
                        <td className="px-4 py-3 text-sm text-foreground-800">
                          {row.sourceLabel}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground-700">
                          {row.date}
                        </td>
                        <td className="px-4 py-3 text-sm">{row.total}</td>
                        <td className="px-4 py-3 text-sm">{row.added}</td>
                        <td className="px-4 py-3 text-sm">{row.duplicates}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              className="text-sm"
              disabled={!source}
              onClick={() => setStep(1)}
            >
              Continue
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <p className="text-sm text-foreground-600">
              These filters search tenders already ingested from{" "}
              <span className="font-semibold">
                {selectedSource?.name ?? "the selected source"}
              </span>
              . They do not change qualification status and are not sent to a
              live portal crawler from this page.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="import-keywords">Keywords</Label>
                <Input
                  id="import-keywords"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="Title, reference no. or organization"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-location">Location</Label>
                <Input
                  id="import-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City or state"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-min-value">Min value</Label>
                <Input
                  id="import-min-value"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  placeholder="e.g. 10 L or 1 Cr"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-max-value">Max value</Label>
                <Input
                  id="import-max-value"
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  placeholder="e.g. 5 Cr"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-min-days">Minimum days to deadline</Label>
                <Input
                  id="import-min-days"
                  value={minDays}
                  onChange={(e) => setMinDays(e.target.value)}
                  placeholder="e.g. 7"
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="secondary" onClick={() => setStep(0)}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <Button type="button" onClick={loadPreview} disabled={isPending}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              Preview tenders
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <p className="text-sm text-foreground-500">
            Showing {previewRows.length} of {previewTotal.toLocaleString("en-IN")}{" "}
            ingested tenders
            {newCandidates.length === 0
              ? " · duplicates are unselected by default"
              : null}
          </p>
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="border-b border-background-200/70 bg-background-50 text-left text-xs font-semibold uppercase tracking-wider text-foreground-500">
                    <th className="w-10 px-4 py-3">
                      <Checkbox
                        checked={
                          previewRows.length > 0 &&
                          previewRows.every((row) => selectedIds.has(row.id))
                        }
                        onCheckedChange={(value) => {
                          setSelectedIds(
                            value === true
                              ? new Set(previewRows.map((row) => row.id))
                              : new Set(),
                          );
                        }}
                        aria-label="Select all preview rows"
                      />
                    </th>
                    <th className="px-4 py-3">Title / Reference</th>
                    <th className="px-4 py-3">Organization</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Value</th>
                    <th className="px-4 py-3">Deadline</th>
                    <th className="px-4 py-3">Duplicate</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-sm text-foreground-500"
                      >
                        No ingested tenders matched these filters.
                      </td>
                    </tr>
                  ) : (
                    previewRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-background-200/70 last:border-0"
                      >
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={selectedIds.has(row.id)}
                            onCheckedChange={(value) => {
                              setSelectedIds((current) => {
                                const next = new Set(current);
                                if (value === true) next.add(row.id);
                                else next.delete(row.id);
                                return next;
                              });
                            }}
                            aria-label={`Select ${row.title}`}
                          />
                        </td>
                        <td className="max-w-[280px] px-4 py-3">
                          <p className="line-clamp-1 text-sm font-medium text-foreground-800">
                            {row.title}
                          </p>
                          <p className="mt-0.5 text-xs text-foreground-400">
                            {row.folderId || row.sourceTenderId}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground-700">
                          {row.organization || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <CategoryCapsule category={row.category} />
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-foreground-800">
                          {
                            formatTenderValue({
                              amount: row.tenderValue,
                              text: row.tenderValueText,
                            }).label
                          }
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground-700">
                          {formatDate(row.closingDate, "yyyy-MM-dd")}
                        </td>
                        <td className="px-4 py-3">
                          {row.isDuplicate ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              Duplicate
                            </span>
                          ) : (
                            <span className="text-xs text-foreground-400">New</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <Button
              type="button"
              disabled={selectedCount === 0 || isPending}
              onClick={runImport}
            >
              Import {selectedCount} tender{selectedCount === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 text-center shadow-sm">
          <Loader2 className="size-8 animate-spin text-primary-500" />
          <h2 className="mt-4 text-base font-semibold text-foreground-900">
            Importing tenders...
          </h2>
          <p className="mt-1 max-w-md text-sm text-foreground-500">
            Checking selected records against the TenderFlow database. Live
            portal crawling is not started from this page.
          </p>
        </div>
      ) : null}

      {step === 4 && result ? (
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
            <h2 className="mt-3 text-lg font-semibold text-foreground-900">
              Import complete
            </h2>
            <p className="mt-1 text-sm text-foreground-500">
              Records are uniquely keyed by portal + portal tender ID. Existing
              rows were not inserted again.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="text-lg font-bold text-emerald-700">
                  {result.newAdded}
                </p>
                <p className="text-xs text-emerald-700">New added</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3">
                <p className="text-lg font-bold text-amber-700">
                  {result.duplicates}
                </p>
                <p className="text-xs text-amber-700">Duplicates</p>
              </div>
              <div className="rounded-lg bg-rose-50 p-3">
                <p className="text-lg font-bold text-rose-700">
                  {result.failed}
                </p>
                <p className="text-xs text-rose-700">Failed</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" onClick={resetWizard}>
              <PlugZap className="size-4" />
              Import more
            </Button>
            <Button asChild>
              <Link href="/tenders">View in pipeline</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
