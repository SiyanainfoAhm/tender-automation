"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  FileText,
  FolderPlus,
  Plus,
  Search,
  Upload,
} from "lucide-react";

import type { CompanyDocument } from "@/server/repositories/documentRepository";
import type { CompanyExperience } from "@/lib/experience/types";
import { DOCUMENT_CATEGORIES } from "@/lib/company/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { UploadDocumentDialog } from "@/components/documents/upload-document-dialog";
import { DocumentCard } from "@/components/documents/document-card";
import { ExperienceCard } from "@/components/documents/experience-card";
import { PastExperienceDialog } from "@/components/documents/past-experience-dialog";
import { cn } from "@/lib/utils";

type DocumentsClientProps = {
  canUpload: boolean;
  canDelete?: boolean;
  documents: CompanyDocument[];
  experience: CompanyExperience[];
  documentCount: number;
  experienceCount: number;
};

export function DocumentsClient({
  canUpload,
  canDelete = false,
  documents,
  experience,
  documentCount,
  experienceCount,
}: DocumentsClientProps) {
  const [tab, setTab] = useState("library");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState<
    "general" | "certificate" | "financial"
  >("general");
  const [experienceOpen, setExperienceOpen] = useState(false);
  const [experienceMode, setExperienceMode] = useState<
    "create" | "edit" | "view"
  >("create");
  const [selectedExperience, setSelectedExperience] =
    useState<CompanyExperience | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return documents.filter((d) => {
      if (category !== "All" && d.documentCategory !== category) return false;
      if (!needle) return true;
      const hay = [
        d.name,
        d.originalFileName,
        d.certificateType,
        d.documentCategory,
        d.documentType,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [documents, q, category]);

  const filters = ["All", ...DOCUMENT_CATEGORIES.filter((c) => c !== "General")];

  function openCreateExperience() {
    setSelectedExperience(null);
    setExperienceMode("create");
    setExperienceOpen(true);
  }

  function openExperience(item: CompanyExperience, mode: "edit" | "view") {
    setSelectedExperience(item);
    setExperienceMode(mode);
    setExperienceOpen(true);
  }

  const headerActions =
    tab === "experience" ? (
      canUpload ? (
        <Button size="sm" onClick={openCreateExperience}>
          <Plus className="size-4" />
          Add Experience
        </Button>
      ) : null
    ) : (
      <>
        {canUpload ? (
          <div className="relative">
            <details className="group">
              <summary className="list-none">
                <Button size="sm" asChild>
                  <span className="cursor-pointer">
                    <Upload className="size-4" />
                    Upload
                  </span>
                </Button>
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-border bg-white p-1 shadow-sm">
                {(
                  [
                    ["general", "General Document"],
                    ["certificate", "Certificate"],
                    ["financial", "Financial Document"],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className="flex w-full rounded-md px-3 py-2 text-left text-sm text-text-secondary hover:bg-primary-50 hover:text-primary-700"
                    onClick={() => {
                      setUploadKind(kind);
                      setUploadOpen(true);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </details>
          </div>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          disabled
          title="Folders will be enabled in a later phase"
        >
          <FolderPlus className="size-4" />
          New Folder
        </Button>
      </>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents & Experience"
        subtitle="Manage all company documents, certificates, and past project experience records"
        actions={headerActions}
      />

      <div className="flex w-fit items-center gap-1 rounded-lg bg-background-100 p-1">
        <button
          type="button"
          onClick={() => setTab("library")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
            tab === "library"
              ? "bg-white text-foreground-900"
              : "text-foreground-500 hover:text-foreground-700",
          )}
        >
          Document Library
          <span className="rounded-full bg-background-200 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-500">
            {documentCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab("experience")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
            tab === "experience"
              ? "bg-white text-foreground-900"
              : "text-foreground-500 hover:text-foreground-700",
          )}
        >
          Past Experience
          <span className="rounded-full bg-background-200 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-500">
            {experienceCount}
          </span>
        </button>
      </div>

      {tab === "library" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search documents…"
                className="pl-9 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {filters.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setCategory(f)}
                  className={cn(
                    "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                    category === f
                      ? "bg-primary-500 text-white"
                      : "bg-background-100 text-foreground-600 hover:bg-background-200",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents yet"
              description={
                canUpload
                  ? "Upload certificates, financials, and general company documents."
                  : "No documents are available for your company yet."
              }
              className="min-h-0 py-12"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  canManage={canDelete}
                />
              ))}
            </div>
          )}
        </div>
      ) : experience.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No past experience records"
          description="Company project experience will appear here when added."
          className="min-h-0 py-12"
        />
      ) : (
        <div className="space-y-4">
          {experience.map((item) => (
            <ExperienceCard
              key={item.id}
              experience={item}
              canManage={canUpload}
              onView={(row) => openExperience(row, "view")}
              onEdit={(row) => openExperience(row, "edit")}
            />
          ))}
        </div>
      )}

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        kind={uploadKind}
      />
      <PastExperienceDialog
        open={experienceOpen}
        onOpenChange={setExperienceOpen}
        mode={experienceMode}
        experience={selectedExperience}
      />
    </div>
  );
}
