"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatTenderValue } from "@/lib/format";
import { TENDER_STATUSES } from "@/lib/tender-status";
import type {
  BidPreparationTender,
  BidProfileTemplate,
} from "@/lib/templates/types";
import { searchBidPreparationTendersAction } from "@/server/actions/templates";
import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import { StatusBadge } from "@/components/status/qualification-badge";
import type { QualificationStatus } from "@/components/status/qualification-badge";

type BidPreparationProps = {
  templates: BidProfileTemplate[];
  resetNonce: number;
};

export function BidPreparation({ templates, resetNonce }: BidPreparationProps) {
  const [tenderId, setTenderId] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [results, setResults] = useState<BidPreparationTender[] | null>(null);
  const [selected, setSelected] = useState<BidPreparationTender | null>(null);
  const [templateId, setTemplateId] = useState(
    templates.find((t) => t.isDefault)?.id || templates[0]?.id || "",
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setTenderId("");
    setReferenceNo("");
    setResults(null);
    setSelected(null);
    setTemplateId(
      templates.find((t) => t.isDefault)?.id || templates[0]?.id || "",
    );
  }, [resetNonce, templates]);

  function handleSearch() {
    if (!tenderId.trim() && !referenceNo.trim()) {
      toast.error("Enter a Tender ID or Reference Number.");
      return;
    }
    startTransition(async () => {
      const result = await searchBidPreparationTendersAction(
        tenderId,
        referenceNo,
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const rows = result.tenders || [];
      if (rows.length === 0) {
        setResults([]);
        setSelected(null);
        toast.error("Tender not found.");
        return;
      }
      setResults(rows);
      setSelected(rows.length === 1 ? rows[0]! : null);
    });
  }

  function handlePrepare() {
    if (!selected) {
      toast.error("Select a tender first.");
      return;
    }
    if (!templateId) {
      toast.error("Select a bid profile template.");
      return;
    }
    toast.message("Tender and template selected.", {
      description:
        "Bid document generation is not available yet. The selected IDs are ready for a later workflow.",
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="prep-tender-id">Tender ID</Label>
            <Input
              id="prep-tender-id"
              value={tenderId}
              onChange={(e) => setTenderId(e.target.value)}
              placeholder="Enter Tender ID"
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prep-reference-no">Reference No</Label>
            <Input
              id="prep-reference-no"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              placeholder="Enter Reference No"
              disabled={pending}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={pending}
              onClick={handleSearch}
            >
              {pending ? "Searching..." : "Search"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!selected ? (
        results && results.length > 1 ? (
          <div className="overflow-hidden rounded-lg border border-border bg-white">
            <p className="border-b border-border px-3 py-2 text-xs font-medium text-text-muted">
              Multiple tenders matched. Select one to continue.
            </p>
            <ul>
              {results.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-surface-muted/40"
                    onClick={() => setSelected(row)}
                  >
                    <span className="text-sm font-medium text-text-primary">
                      {row.title || "Untitled tender"}
                    </span>
                    <span className="text-xs text-text-muted">
                      ID {row.sourceTenderId}
                      {row.folderId ? ` · Ref ${row.folderId}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon={Search}
            title="Search for a tender to begin"
            description="Enter a Tender ID or Reference Number above"
            className="min-h-[360px]"
          />
        )
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    {selected.title || "Untitled tender"}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {selected.organization || "Organization not specified"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.sourcePortal === "TENDER247" ||
                  selected.sourcePortal === "BIDASSIST" ? (
                    <SourceBadge
                      source={selected.sourcePortal as TenderSource}
                    />
                  ) : null}
                  {selected.qualificationStatus &&
                  (TENDER_STATUSES as readonly string[]).includes(
                    selected.qualificationStatus,
                  ) ? (
                    <StatusBadge
                      status={
                        selected.qualificationStatus as QualificationStatus
                      }
                    />
                  ) : null}
                </div>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-[11px] text-text-muted">Tender ID</dt>
                  <dd className="font-medium">{selected.sourceTenderId}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-text-muted">
                    Reference Number
                  </dt>
                  <dd className="font-medium">
                    {selected.folderId || selected.sourceTenderId}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-text-muted">
                    Estimated Value
                  </dt>
                  <dd className="font-medium">
                    {formatTenderValue({
                      amount: selected.tenderValue,
                      text: selected.tenderValueText,
                    }).label}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-text-muted">Deadline</dt>
                  <dd className="font-medium">
                    {formatDate(selected.closingDate)}
                  </dd>
                </div>
              </dl>
              <Link
                href={`/tenders/${selected.id}`}
                className="text-xs font-medium text-primary hover:underline"
              >
                Open tender details
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-5">
              <Label htmlFor="prep-template">Select Bid Profile Template</Label>
              {templates.length === 0 ? (
                <p className="text-sm text-text-muted">
                  No templates yet. Create one in Manage Templates.
                </p>
              ) : (
                <select
                  id="prep-template"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm"
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.templateName}
                      {template.isDefault ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
              )}
              <Button
                type="button"
                disabled={!selected || !templateId}
                onClick={handlePrepare}
              >
                Prepare Bid
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
