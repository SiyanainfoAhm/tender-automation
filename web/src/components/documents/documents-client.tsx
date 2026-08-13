"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  FileText,
  FolderPlus,
  Search,
  Upload,
} from "lucide-react";

import type { CompanyDocument, CompanyExperience } from "@/server/repositories/documentRepository";
import { DOCUMENT_CATEGORIES } from "@/lib/company/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadDocumentDialog } from "@/components/documents/upload-document-dialog";
import { DocumentCard } from "@/components/documents/document-card";
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
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState<
    "general" | "certificate" | "financial"
  >("general");

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Documents & Experience</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Manage all company documents, certificates, and past project
            experience records
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled
            title="Folders will be enabled in a later phase"
          >
            <FolderPlus className="size-4" />
            New Folder
          </Button>
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
        </div>
      </div>

      <Tabs defaultValue="library">
        <TabsList>
          <TabsTrigger value="library">
            Document Library ({documentCount})
          </TabsTrigger>
          <TabsTrigger value="experience">
            Past Experience ({experienceCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="space-y-4 pt-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search documents…"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setCategory(f)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  category === f
                    ? "border-primary/30 bg-primary-50 text-primary-700"
                    : "border-border bg-white text-text-secondary hover:bg-surface-muted",
                )}
              >
                {f}
              </button>
            ))}
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
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  canManage={canDelete}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="experience" className="pt-4">
          {experience.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No past experience records"
              description="Company project experience will appear here when added."
            />
          ) : (
            <div className="grid gap-3">
              {experience.map((item) => (
                <Card key={item.id}>
                  <CardContent className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        {item.projectName}
                      </p>
                      <p className="text-xs text-text-muted">
                        {item.clientName || "Client not specified"}
                      </p>
                    </div>
                    {item.projectValueInr != null ? (
                      <Badge variant="outline">
                        ₹{item.projectValueInr.toLocaleString("en-IN")}
                      </Badge>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        kind={uploadKind}
      />
    </div>
  );
}
