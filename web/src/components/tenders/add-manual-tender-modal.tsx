"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { PROJECT_CATEGORIES } from "@/lib/project-category";
import { STATUS_DISPLAY_LABELS, TENDER_STATUSES } from "@/lib/tender-status";
import { cn } from "@/lib/utils";
import { createManualTenderAction } from "@/server/actions/tender-create";

type Contact = { name: string; mobile: string; email: string };

type AddManualTenderModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (tenderId: string) => void;
};

const EMPTY_CONTACT: Contact = { name: "", mobile: "", email: "" };

const EXEMPTION_TYPES = ["Turnover", "Experience", "EMD"] as const;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-rose-600">{message}</p>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-foreground-900">{children}</h3>
  );
}

export function AddManualTenderModal({
  open,
  onOpenChange,
  onCreated,
}: AddManualTenderModalProps) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [title, setTitle] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [portal, setPortal] = useState<"MANUAL" | "TENDER247" | "BIDASSIST">(
    "MANUAL",
  );
  const [portalLink, setPortalLink] = useState("");
  const [category, setCategory] = useState<string>(PROJECT_CATEGORIES[0]);
  const [tenderType, setTenderType] = useState("");
  const [organization, setOrganization] = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [initialStatus, setInitialStatus] = useState<string>("");
  const [creationDate, setCreationDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [tenderEstCost, setTenderEstCost] = useState("");
  const [emd, setEmd] = useState("");
  const [tenderFee, setTenderFee] = useState("");
  const [processingFee, setProcessingFee] = useState("");
  const [finalCost, setFinalCost] = useState("");
  const [msmeExemption, setMsmeExemption] = useState(false);
  const [startupExemption, setStartupExemption] = useState(false);
  const [exemptionTypes, setExemptionTypes] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([{ ...EMPTY_CONTACT }]);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [noBidReason, setNoBidReason] = useState("");

  const showExemptions = msmeExemption || startupExemption;
  const showNoBidReason = initialStatus === "NO_GO";

  const firstErrorSummary = useMemo(() => {
    if (formError) return formError;
    const first = Object.values(fieldErrors)[0]?.[0];
    return first || null;
  }, [fieldErrors, formError]);

  function resetForm() {
    setFormError(null);
    setFieldErrors({});
    setTitle("");
    setReferenceNo("");
    setPortal("MANUAL");
    setPortalLink("");
    setCategory(PROJECT_CATEGORIES[0]);
    setTenderType("");
    setOrganization("");
    setDepartment("");
    setLocation("");
    setInitialStatus("");
    setCreationDate("");
    setDeadline("");
    setEstimatedValue("");
    setTenderEstCost("");
    setEmd("");
    setTenderFee("");
    setProcessingFee("");
    setFinalCost("");
    setMsmeExemption(false);
    setStartupExemption(false);
    setExemptionTypes([]);
    setContacts([{ ...EMPTY_CONTACT }]);
    setDescription("");
    setNotes("");
    setNoBidReason("");
  }

  function err(key: string) {
    return fieldErrors[key]?.[0];
  }

  function parseAmount(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(n) ? n : Number.NaN;
  }

  function toggleExemptionType(value: string) {
    setExemptionTypes((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  }

  function submit() {
    setFormError(null);
    setFieldErrors({});

    const payload = {
      title,
      referenceNo,
      portal,
      portalLink,
      category,
      tenderType: tenderType || null,
      organization,
      department: department || null,
      location,
      initialStatus: initialStatus || null,
      creationDate,
      deadline,
      estimatedValue: parseAmount(estimatedValue) ?? -1,
      tenderEstCost: parseAmount(tenderEstCost),
      emd: parseAmount(emd),
      tenderFee: parseAmount(tenderFee),
      processingFee: parseAmount(processingFee),
      finalCost: parseAmount(finalCost),
      msmeExemption,
      startupExemption,
      exemptionTypes: showExemptions ? exemptionTypes : [],
      contacts: contacts.map((c) => ({
        name: c.name,
        mobile: c.mobile,
        email: c.email,
      })),
      description,
      notes: notes || null,
      noBidReason: noBidReason || null,
    };

    startTransition(async () => {
      const result = await createManualTenderAction(payload);
      if (!result.ok) {
        setFormError(result.error);
        setFieldErrors(result.fieldErrors || {});
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      resetForm();
      onOpenChange(false);
      onCreated?.(result.id);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-[min(920px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
      >
        <DialogHeader className="sticky top-0 z-10 shrink-0 border-b border-border bg-card px-6 py-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground-900">
                Add Manual Tender
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-sm text-foreground-500">
                Create a new tender record manually
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              disabled={pending}
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          {firstErrorSummary ? (
            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {firstErrorSummary}
            </div>
          ) : null}
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section className="space-y-4">
            <SectionTitle>Basic Information</SectionTitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mt-title">Tender Name *</Label>
                <Input
                  id="mt-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={pending}
                />
                <FieldError message={err("title")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-ref">Reference No *</Label>
                <Input
                  id="mt-ref"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  disabled={pending}
                />
                <FieldError message={err("referenceNo")} />
              </div>
              <div className="space-y-1.5">
                <Label>Portal *</Label>
                <Select
                  value={portal}
                  disabled={pending}
                  onValueChange={(v) =>
                    setPortal(v as "MANUAL" | "TENDER247" | "BIDASSIST")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUAL">Manual</SelectItem>
                    <SelectItem value="TENDER247">Tender247</SelectItem>
                    <SelectItem value="BIDASSIST">BidAssist</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-link">Portal Link</Label>
                <Input
                  id="mt-link"
                  value={portalLink}
                  onChange={(e) => setPortalLink(e.target.value)}
                  placeholder="https://"
                  disabled={pending}
                />
                <FieldError message={err("portalLink")} />
              </div>
              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select
                  value={category}
                  disabled={pending}
                  onValueChange={setCategory}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_CATEGORIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={err("category")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-type">Tender Type</Label>
                <Input
                  id="mt-type"
                  value={tenderType}
                  onChange={(e) => setTenderType(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-org">Organization *</Label>
                <Input
                  id="mt-org"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  disabled={pending}
                />
                <FieldError message={err("organization")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-dept">Department</Label>
                <Input
                  id="mt-dept"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-location">Location *</Label>
                <Input
                  id="mt-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={pending}
                />
                <FieldError message={err("location")} />
              </div>
              <div className="space-y-1.5">
                <Label>Initial Status</Label>
                <Select
                  value={initialStatus || "none"}
                  disabled={pending}
                  onValueChange={(v) =>
                    setInitialStatus(v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Not evaluated" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not evaluated</SelectItem>
                    {TENDER_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS_DISPLAY_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle>Dates</SectionTitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mt-created">Creation Date *</Label>
                <Input
                  id="mt-created"
                  type="date"
                  value={creationDate}
                  onChange={(e) => setCreationDate(e.target.value)}
                  disabled={pending}
                />
                <FieldError message={err("creationDate")} />
                <p className="text-[11px] text-foreground-400">
                  Stored as publication date (`published_date`). System
                  `created_at` is set automatically.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-deadline">Deadline *</Label>
                <Input
                  id="mt-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  disabled={pending}
                />
                <FieldError message={err("deadline")} />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle>Financial Details</SectionTitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(
                [
                  ["estimatedValue", "Estimated Value (₹) *", estimatedValue, setEstimatedValue],
                  ["tenderEstCost", "Tender Est. Cost (₹)", tenderEstCost, setTenderEstCost],
                  ["emd", "EMD (₹)", emd, setEmd],
                  ["tenderFee", "Tender Fee (₹)", tenderFee, setTenderFee],
                  ["processingFee", "Processing Fee (₹)", processingFee, setProcessingFee],
                  ["finalCost", "Final Cost / Bid Value (₹)", finalCost, setFinalCost],
                ] as const
              ).map(([key, label, value, setter]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`mt-${key}`}>{label}</Label>
                  <Input
                    id={`mt-${key}`}
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    disabled={pending}
                  />
                  <FieldError message={err(key)} />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle>Exemptions</SectionTitle>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3",
                  msmeExemption && "border-primary-300 bg-primary-50/40",
                )}
              >
                <Checkbox
                  checked={msmeExemption}
                  disabled={pending}
                  onCheckedChange={(v) => setMsmeExemption(v === true)}
                />
                <span className="text-sm text-foreground-800">
                  MSME Exemption Applicable
                </span>
              </label>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3",
                  startupExemption && "border-primary-300 bg-primary-50/40",
                )}
              >
                <Checkbox
                  checked={startupExemption}
                  disabled={pending}
                  onCheckedChange={(v) => setStartupExemption(v === true)}
                />
                <span className="text-sm text-foreground-800">
                  Startup India Exemption Applicable
                </span>
              </label>
            </div>
            {showExemptions ? (
              <div className="flex flex-wrap gap-2">
                {EXEMPTION_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    disabled={pending}
                    onClick={() => toggleExemptionType(type)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium",
                      exemptionTypes.includes(type)
                        ? "border-primary-400 bg-primary-50 text-primary-700"
                        : "border-border bg-card text-foreground-600",
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="space-y-4">
            <SectionTitle>Contact Details</SectionTitle>
            <div className="space-y-3">
              {contacts.map((contact, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 md:grid-cols-[1fr_1fr_1fr_auto]"
                >
                  <div className="space-y-1.5">
                    <Label>Name *</Label>
                    <Input
                      value={contact.name}
                      disabled={pending}
                      onChange={(e) => {
                        const next = [...contacts];
                        next[index] = { ...contact, name: e.target.value };
                        setContacts(next);
                      }}
                    />
                    <FieldError message={err(`contacts.${index}.name`)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mobile *</Label>
                    <Input
                      value={contact.mobile}
                      disabled={pending}
                      onChange={(e) => {
                        const next = [...contacts];
                        next[index] = { ...contact, mobile: e.target.value };
                        setContacts(next);
                      }}
                    />
                    <FieldError message={err(`contacts.${index}.mobile`)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      value={contact.email}
                      disabled={pending}
                      onChange={(e) => {
                        const next = [...contacts];
                        next[index] = { ...contact, email: e.target.value };
                        setContacts(next);
                      }}
                    />
                    <FieldError message={err(`contacts.${index}.email`)} />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      disabled={pending || contacts.length === 1}
                      aria-label="Remove contact"
                      onClick={() =>
                        setContacts((prev) => prev.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="h-8 gap-1.5 text-sm"
                disabled={pending}
                onClick={() =>
                  setContacts((prev) => [...prev, { ...EMPTY_CONTACT }])
                }
              >
                <Plus className="size-3.5" />
                Add Contact
              </Button>
              <p className="text-[11px] text-foreground-400">
                Contacts are stored on the tender record metadata. Primary
                contact name is also mirrored to authority for list search.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle>Additional Details</SectionTitle>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mt-desc">Description *</Label>
                <Textarea
                  id="mt-desc"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={pending}
                />
                <FieldError message={err("description")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-notes">Final Decision / Notes</Label>
                <Textarea
                  id="mt-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={pending}
                />
              </div>
              {showNoBidReason ? (
                <div className="space-y-1.5">
                  <Label htmlFor="mt-nobid">No Bid Reason *</Label>
                  <Textarea
                    id="mt-nobid"
                    rows={2}
                    value={noBidReason}
                    onChange={(e) => setNoBidReason(e.target.value)}
                    disabled={pending}
                  />
                  <FieldError message={err("noBidReason")} />
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <DialogFooter className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-card px-6 py-4 sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Add Tender"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
