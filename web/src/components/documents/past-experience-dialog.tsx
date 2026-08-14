"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  FileText,
  Loader2,
  Paperclip,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "@/lib/company/types";
import { NATURE_OF_WORK_OPTIONS } from "@/lib/experience/nature-of-work";
import type { CompanyExperience } from "@/lib/experience/types";
import { formatBytes, formatIndianCurrency } from "@/lib/format";
import {
  createCompanyExperienceAction,
  updateCompanyExperienceAction,
} from "@/server/actions/experience";
import { cn } from "@/lib/utils";

type ExperienceDialogMode = "create" | "edit" | "view";

type PastExperienceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ExperienceDialogMode;
  experience?: CompanyExperience | null;
};

function PdfDropzone({
  id,
  label,
  required,
  disabled,
  disabledMessage,
  file,
  existingName,
  existingHref,
  onFileChange,
}: {
  id: string;
  label: string;
  required?: boolean;
  disabled: boolean;
  disabledMessage?: string;
  file: File | null;
  existingName?: string | null;
  existingHref?: string | null;
  onFileChange: (next: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function assignFile(next: File | null) {
    if (!next) {
      onFileChange(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (!next.name.toLowerCase().endsWith(".pdf")) {
      toast.error(`${label} must be a PDF.`);
      return;
    }
    if (next.size > MAX_DOCUMENT_UPLOAD_BYTES) {
      toast.error(`${label} exceeds the 25 MB limit.`);
      return;
    }
    onFileChange(next);
  }

  const selectedLabel = file
    ? `${file.name} · ${formatBytes(file.size)}`
    : existingName
      ? `Current: ${existingName}`
      : null;

  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block">
        {label}
        {required ? " *" : ""}
      </Label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (disabled) return;
          assignFile(event.dataTransfer.files?.[0] || null);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
          disabled
            ? "cursor-not-allowed border-background-200 bg-background-100 text-foreground-400"
            : dragOver
              ? "border-primary-400 bg-primary-50"
              : "border-background-200 bg-white hover:bg-background-100",
        )}
      >
        <FileText className="mb-2 size-5 text-foreground-400" />
        {disabled && disabledMessage ? (
          <span className="text-sm text-foreground-400">{disabledMessage}</span>
        ) : selectedLabel ? (
          <span className="text-sm text-foreground-700">{selectedLabel}</span>
        ) : (
          <>
            <span className="text-sm font-medium text-foreground-700">
              Drag & drop or browse
            </span>
            <span className="mt-1 text-xs text-foreground-400">
              PDF up to 25 MB
            </span>
          </>
        )}
      </button>
      {existingHref && !file ? (
        <a
          href={existingHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-block text-xs font-medium text-primary-600 hover:underline"
        >
          View current file
        </a>
      ) : null}
      {file && !disabled ? (
        <button
          type="button"
          className="mt-1.5 text-xs text-foreground-500 hover:text-foreground-800"
          onClick={() => assignFile(null)}
        >
          Remove selected file
        </button>
      ) : null}
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="application/pdf,.pdf"
        disabled={disabled}
        className="sr-only"
        onChange={(event) => assignFile(event.target.files?.[0] || null)}
      />
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  children,
}: {
  icon: typeof BriefcaseBusiness;
  children: string;
}) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
      <Icon className="size-3.5" />
      {children}
    </h3>
  );
}

export function PastExperienceDialog({
  open,
  onOpenChange,
  mode,
  experience,
}: PastExperienceDialogProps) {
  const router = useRouter();
  const isEditing = mode === "edit";
  const isViewing = mode === "view";
  const action = isEditing
    ? updateCompanyExperienceAction
    : createCompanyExperienceAction;
  const [state, formAction, pending] = useActionState(action, {});
  const [formKey, setFormKey] = useState(0);
  const [ongoing, setOngoing] = useState(
    experience ? experience.projectStatus !== "completed" : true,
  );
  const [natureOfWork, setNatureOfWork] = useState(
    experience?.natureOfWork || "",
  );
  const [workOrderFile, setWorkOrderFile] = useState<File | null>(null);
  const [completionFile, setCompletionFile] = useState<File | null>(null);
  const submissionPendingRef = useRef(false);
  const readOnly = isViewing || pending;

  useEffect(() => {
    submissionPendingRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setOngoing(experience ? experience.projectStatus !== "completed" : true);
    setNatureOfWork(experience?.natureOfWork || "");
    setWorkOrderFile(null);
    setCompletionFile(null);
    setFormKey((k) => k + 1);
  }, [open, experience?.id, experience?.projectStatus, experience?.natureOfWork]);

  useEffect(() => {
    if (!submissionPendingRef.current) return;
    if (state?.ok) {
      submissionPendingRef.current = false;
      toast.success(isEditing ? "Experience updated." : "Experience added.");
      onOpenChange(false);
      router.refresh();
      return;
    }
    if (state?.error) {
      submissionPendingRef.current = false;
      toast.error(state.error);
    }
  }, [state, isEditing, onOpenChange, router]);

  function handleOpenChange(next: boolean) {
    if (pending && !next) return;
    onOpenChange(next);
  }

  function handleAction(formData: FormData) {
    formData.set("projectStatus", ongoing ? "ongoing" : "completed");
    formData.set("natureOfWork", natureOfWork);
    if (workOrderFile) formData.set("workOrder", workOrderFile);
    if (!ongoing && completionFile) {
      formData.set("completionCertificate", completionFile);
    }
    if (
      isEditing &&
      experience?.projectStatus === "completed" &&
      ongoing &&
      experience.completionCertificateUrl
    ) {
      formData.set("clearCompletionCertificate", "true");
    }
    formAction(formData);
  }

  const title =
    mode === "edit"
      ? "Edit Past Experience"
      : mode === "view"
        ? "Past Experience"
        : "Add Past Experience";
  const subtitle =
    mode === "edit"
      ? "Update project experience and supporting documents."
      : mode === "view"
        ? "Completed or ongoing project details with supporting documents."
        : "Record completed or ongoing project details with work order and completion certificates.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex w-[calc(100%-1rem)] max-h-[90vh] max-w-[600px] flex-col gap-0 overflow-hidden rounded-xl border border-background-200/70 bg-white p-0 shadow-2xl sm:w-[calc(100%-2rem)]"
        onEscapeKeyDown={(e) => {
          if (pending) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-background-200/70 px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary">
              <BriefcaseBusiness className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">
                {subtitle}
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
            className="rounded-md p-1 text-foreground-400 transition-colors hover:bg-background-100 hover:text-foreground-900 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <form
          key={formKey}
          action={isViewing ? undefined : handleAction}
          onSubmit={(event) => {
            if (isViewing) {
              event.preventDefault();
              return;
            }
            if (pending) {
              event.preventDefault();
              return;
            }
            if (!natureOfWork) {
              event.preventDefault();
              toast.error("Select nature of work");
              return;
            }
            if (mode === "create" && !workOrderFile) {
              event.preventDefault();
              toast.error("Work Order is required.");
              return;
            }
            if (mode === "create" && !ongoing && !completionFile) {
              event.preventDefault();
              toast.error(
                "Completion Certificate is required for completed projects.",
              );
              return;
            }
            if (
              isEditing &&
              experience?.projectStatus === "completed" &&
              ongoing &&
              experience.completionCertificateUrl &&
              !window.confirm(
                "Changing this project to ongoing will remove its completion certificate. Continue?",
              )
            ) {
              event.preventDefault();
              return;
            }
            submissionPendingRef.current = true;
          }}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {isEditing && experience ? (
            <input type="hidden" name="id" value={experience.id} />
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <section className="mb-6">
              <SectionHeading icon={BriefcaseBusiness}>
                Project Details
              </SectionHeading>
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="projectName">Project Name *</Label>
                  <Input
                    id="projectName"
                    name="projectName"
                    required
                    disabled={readOnly}
                    defaultValue={experience?.projectName || ""}
                    placeholder="e.g. UIDAI Data Center Migration"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="clientName">Client / Organization *</Label>
                  <Input
                    id="clientName"
                    name="clientName"
                    required
                    disabled={readOnly}
                    defaultValue={experience?.clientName || ""}
                    placeholder="e.g. UIDAI, Govt of India"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="location">Location *</Label>
                    <Input
                      id="location"
                      name="location"
                      required
                      disabled={readOnly}
                      defaultValue={experience?.location || ""}
                      placeholder="e.g. New Delhi, India"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Nature of Work *</Label>
                    <Select
                      value={natureOfWork || undefined}
                      onValueChange={setNatureOfWork}
                      disabled={readOnly}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select nature..." />
                      </SelectTrigger>
                      <SelectContent>
                        {NATURE_OF_WORK_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="contractValue">Contract Value *</Label>
                  <Input
                    id="contractValue"
                    name="contractValue"
                    required
                    disabled={readOnly}
                    defaultValue={
                      experience
                        ? formatIndianCurrency(experience.projectValueInr)
                        : ""
                    }
                    placeholder="e.g. ₹ 12.5 Cr"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-background-200/70 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground-700">
                      Project Status
                    </p>
                    <p className="text-xs text-foreground-400">
                      {ongoing ? "Marked as ongoing" : "Marked as completed"}
                    </p>
                  </div>
                  <Switch
                    checked={ongoing}
                    disabled={readOnly}
                    onCheckedChange={(checked) => {
                      setOngoing(checked);
                      if (checked) setCompletionFile(null);
                    }}
                    className="data-[state=checked]:bg-primary"
                    aria-label="Project is ongoing"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="startDate">Start Date *</Label>
                    <Input
                      id="startDate"
                      name="startDate"
                      type="date"
                      required
                      disabled={readOnly}
                      defaultValue={experience?.startDate || ""}
                    />
                  </div>
                  {ongoing ? (
                    <div className="space-y-1">
                      <Label htmlFor="expectedCompletionDate">
                        Expected Completion Date
                      </Label>
                      <Input
                        id="expectedCompletionDate"
                        name="expectedCompletionDate"
                        type="date"
                        disabled={readOnly}
                        defaultValue={experience?.expectedCompletionDate || ""}
                      />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label htmlFor="completionDate">Completion Date *</Label>
                      <Input
                        id="completionDate"
                        name="completionDate"
                        type="date"
                        required
                        disabled={readOnly}
                        defaultValue={experience?.endDate || ""}
                      />
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="description">Project Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    rows={3}
                    disabled={readOnly}
                    defaultValue={experience?.description || ""}
                    placeholder="Briefly describe scope, technology and delivered work..."
                  />
                </div>
              </div>
            </section>

            <section className="mb-6">
              <SectionHeading icon={UserRound}>
                Contact Person (Client Side)
              </SectionHeading>
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="contactPersonName">
                    Contact Person Name *
                  </Label>
                  <Input
                    id="contactPersonName"
                    name="contactPersonName"
                    required
                    disabled={readOnly}
                    defaultValue={experience?.contactPersonName || ""}
                    placeholder="e.g. Mr. Rajesh Kumar"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="contactMobile">Mobile Number *</Label>
                    <Input
                      id="contactMobile"
                      name="contactMobile"
                      required
                      disabled={readOnly}
                      defaultValue={experience?.contactMobile || ""}
                      placeholder="+91 98765 43210"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="contactEmail">Email (optional)</Label>
                    <Input
                      id="contactEmail"
                      name="contactEmail"
                      type="email"
                      disabled={readOnly}
                      defaultValue={experience?.contactEmail || ""}
                      placeholder="contact@department.gov.in"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section>
              <SectionHeading icon={Paperclip}>
                Document Attachments
              </SectionHeading>
              <div className="space-y-4">
                <PdfDropzone
                  id="workOrder"
                  label="Work Order"
                  required
                  disabled={readOnly}
                  file={workOrderFile}
                  existingName={experience?.workOrderFileName}
                  existingHref={
                    experience
                      ? `/api/experience/${experience.id}/assets/work-order`
                      : null
                  }
                  onFileChange={setWorkOrderFile}
                />
                <PdfDropzone
                  id="completionCertificate"
                  label="Completion Certificate"
                  required={!ongoing}
                  disabled={readOnly || ongoing}
                  disabledMessage={
                    ongoing
                      ? "Upload available after marking project as completed. PDF up to 25 MB"
                      : undefined
                  }
                  file={completionFile}
                  existingName={
                    ongoing ? null : experience?.completionCertificateFileName
                  }
                  existingHref={
                    !ongoing && experience?.completionCertificateUrl
                      ? `/api/experience/${experience.id}/assets/completion-certificate`
                      : null
                  }
                  onFileChange={setCompletionFile}
                />
              </div>
            </section>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-background-200/70 bg-white px-6 py-4">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
              className="px-4 py-2 text-sm font-medium text-foreground-600 transition-colors hover:text-foreground-900 disabled:opacity-50"
            >
              {isViewing ? "Close" : "Cancel"}
            </button>
            {isViewing ? null : (
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {isEditing ? "Saving..." : "Adding..."}
                  </>
                ) : isEditing ? (
                  "Save Changes"
                ) : (
                  "Add Experience Record"
                )}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
