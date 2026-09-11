"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import {
  CHECKLIST_CATEGORIES,
  areRequirementTitlesSimilar,
  categoryLabel,
  isExactRequirementDuplicate,
  workspaceSectionLabel,
  type RequirementDestinationSection,
} from "@/lib/bid-checklist";
import {
  addChecklistRequirementAction,
  updateChecklistRequirementAction,
} from "@/server/actions/bid-workspace";
import type { ChecklistItemRow } from "@/server/repositories/bidChecklistRepository";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const SECTION_OPTIONS: RequirementDestinationSection[] = [
  "prequalification",
  "technical",
  "annexures",
];

const CATEGORY_OPTIONS = [
  ...CHECKLIST_CATEGORIES.filter((c) => c !== "BOQ" && c !== "COMPLIANCE"),
  "COMPLIANCE",
] as const;

export type AddRequirementDialogMode = "create" | "edit";

type AddRequirementDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenderId: string;
  existingItems: ChecklistItemRow[];
  /** Pre-select when opened from a section tab; null = Checklist Creation. */
  defaultSection: RequirementDestinationSection | null;
  mode?: AddRequirementDialogMode;
  editItem?: ChecklistItemRow | null;
  onSuccess?: (options?: { keepOpen?: boolean; itemId?: string }) => void;
  onFocusExisting?: (itemId: string) => void;
};

export function AddRequirementDialog({
  open,
  onOpenChange,
  tenderId,
  existingItems,
  defaultSection,
  mode = "create",
  editItem = null,
  onSuccess,
  onFocusExisting,
}: AddRequirementDialogProps) {
  const isEdit = mode === "edit" && Boolean(editItem);
  const [title, setTitle] = useState("");
  const [section, setSection] = useState<RequirementDestinationSection>(
    defaultSection || "prequalification",
  );
  const [category, setCategory] = useState<string>("");
  const [description, setDescription] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [fuzzyWarning, setFuzzyWarning] = useState<ChecklistItemRow | null>(
    null,
  );
  const [forceAdd, setForceAdd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (isEdit && editItem) {
      setTitle(editItem.requirementName);
      setSection(editItem.workspaceSection);
      setCategory(editItem.category);
      setDescription(editItem.description || "");
      setSourceReference(editItem.sourceClause || editItem.sourceText || "");
      setFile(null);
      setFuzzyWarning(null);
      setForceAdd(false);
      return;
    }
    setTitle("");
    setSection(defaultSection || "prequalification");
    setCategory("");
    setDescription("");
    setSourceReference("");
    setFile(null);
    setFuzzyWarning(null);
    setForceAdd(false);
  }, [open, isEdit, editItem, defaultSection]);

  const sectionRequired = !defaultSection && !isEdit;

  const exactClash = useMemo(() => {
    const trimmed = title.trim();
    if (!trimmed) return null;
    return (
      existingItems.find(
        (item) =>
          (!isEdit || item.id !== editItem?.id) &&
          isExactRequirementDuplicate(
            { requirementName: trimmed },
            {
              requirementKey: item.requirementKey,
              requirementName: item.requirementName,
            },
          ),
      ) || null
    );
  }, [title, existingItems, isEdit, editItem?.id]);

  const similarItem = useMemo(() => {
    const trimmed = title.trim();
    if (!trimmed || exactClash) return null;
    return (
      existingItems.find(
        (item) =>
          (!isEdit || item.id !== editItem?.id) &&
          areRequirementTitlesSimilar(trimmed, item.requirementName),
      ) || null
    );
  }, [title, existingItems, exactClash, isEdit, editItem?.id]);

  async function submit(options?: { addAnother?: boolean; force?: boolean }) {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Requirement title is required.");
      return;
    }
    if (!section) {
      toast.error("Choose a destination section.");
      return;
    }
    if (exactClash) {
      toast.error(`A requirement with this title already exists.`);
      return;
    }
    if (similarItem && !forceAdd && !options?.force && !isEdit) {
      setFuzzyWarning(similarItem);
      return;
    }

    setSaving(true);
    try {
      if (isEdit && editItem) {
        const result = await updateChecklistRequirementAction({
          tenderId,
          itemId: editItem.id,
          title: trimmed,
          section,
          category: category || null,
          description: description.trim() || null,
          sourceReference: sourceReference.trim() || null,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("Requirement updated.");
        onOpenChange(false);
        onSuccess?.({ itemId: editItem.id });
        return;
      }

      const formData = new FormData();
      formData.set("tenderId", tenderId);
      formData.set("title", trimmed);
      formData.set("section", section);
      if (category) formData.set("category", category);
      if (description.trim()) formData.set("description", description.trim());
      if (sourceReference.trim()) {
        formData.set("sourceReference", sourceReference.trim());
      }
      if (file) formData.set("file", file);

      const result = await addChecklistRequirementAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.uploadFailed) {
        toast.warning(
          result.uploadError ||
            "Requirement added, but document upload failed. Open the requirement to retry upload.",
        );
      } else {
        toast.success(
          file
            ? "Requirement added and document linked."
            : "Requirement added.",
        );
      }

      if (options?.addAnother) {
        setTitle("");
        setDescription("");
        setSourceReference("");
        setFile(null);
        setFuzzyWarning(null);
        setForceAdd(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        onSuccess?.({ keepOpen: true, itemId: result.itemId });
      } else {
        onOpenChange(false);
        onSuccess?.({ itemId: result.itemId });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Requirement" : "Add Checklist Requirement"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this manually added requirement."
              : "Add a requirement the AI missed. It appears in Checklist Creation and the destination section."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="req-title">Requirement Title *</Label>
            <Input
              id="req-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setForceAdd(false);
                setFuzzyWarning(null);
              }}
              placeholder="e.g. Power of Attorney for Authorized Signatory"
              disabled={saving}
            />
            {exactClash ? (
              <p className="text-xs text-rose-600">
                Exact match already exists: {exactClash.requirementName}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Section *</Label>
            <Select
              value={section}
              onValueChange={(value) =>
                setSection(value as RequirementDestinationSection)
              }
              disabled={saving}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose section" />
              </SelectTrigger>
              <SelectContent>
                {SECTION_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {workspaceSectionLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sectionRequired ? (
              <p className="text-xs text-foreground-500">
                Checklist Creation is an aggregate view — pick the real
                destination section.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Category / Type</Label>
            <Select
              value={category || "__none__"}
              onValueChange={(value) =>
                setCategory(value === "__none__" ? "" : value)
              }
              disabled={saving}
            >
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Optional</SelectItem>
                {CATEGORY_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {categoryLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-description">Description / Details</Label>
            <Textarea
              id="req-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional requirement details"
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-ref">Optional source / reference</Label>
            <Input
              id="req-ref"
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
              placeholder="RFP page / clause number / note"
              disabled={saving}
            />
          </div>

          {!isEdit ? (
            <div className="space-y-1.5">
              <Label>Attachment (optional)</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={saving}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-3.5" />
                  {file ? "Change file" : "Upload Document"}
                </Button>
                {file ? (
                  <span className="truncate text-xs text-foreground-600">
                    {file.name}
                  </span>
                ) : (
                  <span className="text-xs text-foreground-400">
                    Completes the requirement when provided
                  </span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                }}
              />
            </div>
          ) : null}

          {fuzzyWarning && !forceAdd ? (
            <div className="rounded-md border border-amber-200 bg-amber-50/80 p-3 text-sm">
              <p className="font-medium text-foreground-800">
                Similar requirement already exists
              </p>
              <p className="mt-1 text-foreground-600">
                {fuzzyWarning.requirementName}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onFocusExisting?.(fuzzyWarning.id);
                    onOpenChange(false);
                  }}
                >
                  View Existing
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setForceAdd(true);
                    setFuzzyWarning(null);
                    void submit({ force: true });
                  }}
                >
                  Add Anyway
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {!isEdit ? (
            <Button
              type="button"
              variant="outline"
              disabled={saving || Boolean(exactClash)}
              onClick={() => void submit({ addAnother: true })}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Add & Add Another
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={saving || Boolean(exactClash)}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEdit ? "Save Changes" : "Add Requirement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
