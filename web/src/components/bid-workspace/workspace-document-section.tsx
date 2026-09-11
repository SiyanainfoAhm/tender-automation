"use client";

import {
  CheckCircle2,
  FileText,
  Sparkles,
  Upload,
} from "lucide-react";

import { DOCUMENT_STATUS_LABELS } from "@/lib/bid-workspace";
import { formatBytes, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { WorkspaceDocumentRow } from "@/lib/bid-workspace";
import type { CompanyDocument } from "@/server/repositories/documentRepository";

export type WorkspaceDocCardModel = {
  id: string;
  title: string;
  fileName: string | null;
  categoryLabel: string;
  fileSizeBytes: number | null;
  statusLabel: string;
  statusTone: "approved" | "ready" | "draft" | "pending" | "expired" | "rejected";
  versionLabel: string | null;
  updatedAt: string | null;
  source: "COMPANY" | "TENDER";
  downloadHref: string | null;
};

function statusToneClasses(tone: WorkspaceDocCardModel["statusTone"]) {
  switch (tone) {
    case "approved":
      return "text-emerald-700";
    case "ready":
      return "text-sky-700";
    case "draft":
      return "text-amber-700";
    case "expired":
    case "rejected":
      return "text-rose-700";
    default:
      return "text-foreground-500";
  }
}

export function mapWorkspaceDocumentCard(
  doc: WorkspaceDocumentRow,
): WorkspaceDocCardModel {
  const tone =
    doc.status === "approved"
      ? "approved"
      : doc.status === "ready"
        ? "ready"
        : doc.status === "drafting"
          ? "draft"
          : "pending";
  return {
    id: doc.id,
    title: doc.title,
    fileName: doc.fileName,
    categoryLabel: doc.documentType,
    fileSizeBytes: doc.fileSizeBytes,
    statusLabel: DOCUMENT_STATUS_LABELS[doc.status] || doc.status,
    statusTone: tone,
    versionLabel: doc.versionLabel,
    updatedAt: doc.updatedAt,
    source: "TENDER",
    downloadHref: doc.hasFile
      ? `/api/bid-workspace/documents/${doc.id}`
      : null,
  };
}

export function mapCompanyReferenceCard(
  doc: CompanyDocument,
  categoryLabel: string,
): WorkspaceDocCardModel {
  const tone =
    doc.expiryState === "EXPIRED"
      ? "expired"
      : doc.verificationStatus === "rejected"
        ? "rejected"
        : doc.verificationStatus === "verified"
          ? "approved"
          : "ready";
  return {
    id: `company:${doc.id}`,
    title: doc.name,
    fileName: doc.originalFileName,
    categoryLabel,
    fileSizeBytes: doc.fileSizeBytes,
    statusLabel:
      doc.expiryState === "EXPIRED"
        ? "Expired"
        : doc.verificationStatus === "verified"
          ? "Approved"
          : doc.verificationStatus === "rejected"
            ? "Rejected"
            : "Ready",
    statusTone: tone,
    versionLabel: null,
    updatedAt: doc.updatedAt,
    source: "COMPANY",
    downloadHref: `/api/documents/${doc.id}`,
  };
}

type WorkspaceDocumentSectionProps = {
  title: string;
  subtitle: string;
  cards: WorkspaceDocCardModel[];
  readyCount: number;
  totalCount: number;
  readOnly: boolean;
  ingesting?: boolean;
  onIngestAi?: () => void;
  onUpload?: () => void;
};

export function WorkspaceDocumentSection({
  title,
  subtitle,
  cards,
  readyCount,
  totalCount,
  readOnly,
  ingesting = false,
  onIngestAi,
  onUpload,
}: WorkspaceDocumentSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-900">
            {title}
          </h2>
          <p className="mt-1 text-sm text-foreground-500">{subtitle}</p>
          <p className="mt-2 text-sm font-medium text-foreground-700">
            {readyCount} of {totalCount} ready
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled>
            Edit Prompt
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={readOnly || ingesting || !onIngestAi}
            onClick={onIngestAi}
          >
            <Sparkles className="size-3.5" />
            {ingesting ? "Ingesting…" : "Use AI"}
          </Button>
          {!readOnly ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-1.5"
              onClick={onUpload}
            >
              <Upload className="size-3.5" />
              Upload
            </Button>
          ) : null}
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-foreground-500">
          No documents in this section yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <article
              key={card.id}
              className="flex min-h-[132px] flex-col rounded-md border border-border bg-white p-3 shadow-none"
            >
              <div className="flex items-start gap-2.5">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded bg-background-100 text-foreground-600">
                  <FileText className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground-900">
                    {card.fileName || card.title}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-foreground-500">
                    {card.categoryLabel}
                    {card.fileSizeBytes != null
                      ? ` · ${formatBytes(card.fileSizeBytes)}`
                      : ""}
                    {card.source === "COMPANY" ? " · Company Document" : ""}
                  </p>
                </div>
              </div>

              <div className="mt-auto border-t border-border pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-[11px] font-medium",
                      statusToneClasses(card.statusTone),
                    )}
                  >
                    {(card.statusTone === "approved" ||
                      card.statusTone === "ready") && (
                      <CheckCircle2 className="size-3" />
                    )}
                    {card.statusLabel}
                  </span>
                  <span className="text-[11px] text-foreground-400">
                    {card.versionLabel || "v1.0"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-foreground-400">
                    {card.updatedAt
                      ? `Updated ${formatRelativeTime(card.updatedAt)}`
                      : "—"}
                  </p>
                  {card.downloadHref ? (
                    <a
                      href={card.downloadHref}
                      className="text-[11px] font-medium text-foreground-700 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
