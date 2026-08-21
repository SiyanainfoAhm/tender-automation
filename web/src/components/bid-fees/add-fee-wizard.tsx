"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

import {
  PaymentModeFields,
  type PaymentReferenceState,
} from "@/components/bid-fees/payment-mode-fields";
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
import {
  BID_FEE_STATUSES,
  BID_FEE_STATUS_LABELS,
  BID_FEE_TYPE_LABELS,
  BID_FEE_TYPES,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  type BidFeeStatus,
  type BidFeeType,
  type PaymentMode,
} from "@/lib/bid-fees";
import { formatIndianCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createBidFeeWithAttachmentsAction } from "@/server/actions/bid-fees";

export type FeeEligibleTender = {
  id: string;
  title: string;
  sourceTenderId: string;
  referenceNo: string | null;
  organization: string | null;
  emdAmount: number | null;
  tenderValue: number | null;
  qualificationStatus: string | null;
};

export type SuggestedAmounts = Partial<Record<BidFeeType, number | null>>;

type FeeDraft = {
  amount: string;
  status: BidFeeStatus;
  paymentMode: PaymentMode | "";
  paymentReference: PaymentReferenceState;
  paymentDate: string;
  dueDate: string;
  refundable: boolean;
  notes: string;
  files: File[];
};

type AddFeeWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eligibleTenders: FeeEligibleTender[];
  preselectTenderId?: string | null;
  preselectFeeTypes?: BidFeeType[];
  suggestedAmounts?: SuggestedAmounts;
};

const STEPS = ["Tender", "Fee Type", "Details", "Review"] as const;

function emptyDraft(suggested?: number | null): FeeDraft {
  return {
    amount: suggested != null && suggested > 0 ? String(suggested) : "",
    status: "pending",
    paymentMode: "",
    paymentReference: {},
    paymentDate: "",
    dueDate: "",
    refundable: false,
    notes: "",
    files: [],
  };
}

function tenderLabel(t: FeeEligibleTender): string {
  const ref = t.referenceNo || t.sourceTenderId;
  return ref ? `${t.title} (${ref})` : t.title;
}

export function AddFeeWizard({
  open,
  onOpenChange,
  eligibleTenders,
  preselectTenderId,
  preselectFeeTypes,
  suggestedAmounts,
}: AddFeeWizardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tenderQuery, setTenderQuery] = useState("");
  const [tenderId, setTenderId] = useState<string>("");
  const [selectedTypes, setSelectedTypes] = useState<BidFeeType[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<BidFeeType, FeeDraft>>>(
    {},
  );

  const selectedTender = useMemo(
    () => eligibleTenders.find((t) => t.id === tenderId) || null,
    [eligibleTenders, tenderId],
  );

  const resolvedSuggestions = useMemo<SuggestedAmounts>(() => {
    const fromTender: SuggestedAmounts = {
      emd: selectedTender?.emdAmount ?? null,
      tender_fee: suggestedAmounts?.tender_fee ?? null,
      processing: suggestedAmounts?.processing ?? null,
      pbg: suggestedAmounts?.pbg ?? selectedTender?.emdAmount ?? null,
      other: suggestedAmounts?.other ?? null,
    };
    return { ...fromTender, ...suggestedAmounts };
  }, [selectedTender, suggestedAmounts]);

  const filteredTenders = useMemo(() => {
    const q = tenderQuery.trim().toLowerCase();
    if (!q) return eligibleTenders;
    return eligibleTenders.filter((t) => {
      const hay = [
        t.title,
        t.sourceTenderId,
        t.referenceNo,
        t.organization,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [eligibleTenders, tenderQuery]);

  function reset() {
    setStep(0);
    setError(null);
    setTenderQuery("");
    setTenderId(preselectTenderId || "");
    setSelectedTypes(preselectFeeTypes?.length ? [...preselectFeeTypes] : []);
    setDrafts({});
  }

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError(null);
    setTenderQuery("");
    setTenderId(preselectTenderId || "");
    setSelectedTypes(preselectFeeTypes?.length ? [...preselectFeeTypes] : []);
    setDrafts({});
  }, [open, preselectTenderId, preselectFeeTypes]);

  function toggleType(type: BidFeeType) {
    setSelectedTypes((prev) => {
      if (prev.includes(type)) {
        setDrafts((d) => {
          const next = { ...d };
          delete next[type];
          return next;
        });
        return prev.filter((t) => t !== type);
      }
      setDrafts((d) => ({
        ...d,
        [type]: d[type] || emptyDraft(resolvedSuggestions[type]),
      }));
      return [...prev, type];
    });
  }

  function ensureDraftsForSelected() {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const type of selectedTypes) {
        if (!next[type]) {
          next[type] = emptyDraft(resolvedSuggestions[type]);
        } else if (!next[type]!.amount && resolvedSuggestions[type]) {
          next[type] = {
            ...next[type]!,
            amount: String(resolvedSuggestions[type]),
          };
        }
      }
      return next;
    });
  }

  function updateDraft(type: BidFeeType, patch: Partial<FeeDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [type]: { ...(prev[type] || emptyDraft()), ...patch },
    }));
  }

  function validateStep(): boolean {
    setError(null);
    if (step === 0) {
      if (!tenderId) {
        setError("Select a tender to continue.");
        return false;
      }
      return true;
    }
    if (step === 1) {
      if (selectedTypes.length === 0) {
        setError("Select at least one fee type.");
        return false;
      }
      return true;
    }
    if (step === 2) {
      for (const type of selectedTypes) {
        const draft = drafts[type];
        if (!draft) {
          setError(`Missing details for ${BID_FEE_TYPE_LABELS[type]}.`);
          return false;
        }
        const amount = Number(String(draft.amount).replace(/,/g, ""));
        if (!Number.isFinite(amount) || amount < 0) {
          setError(`Enter a valid amount for ${BID_FEE_TYPE_LABELS[type]}.`);
          return false;
        }
        if (!draft.files.length) {
          setError(
            `Attach at least one file for ${BID_FEE_TYPE_LABELS[type]}.`,
          );
          return false;
        }
      }
      return true;
    }
    return true;
  }

  function goNext() {
    if (!validateStep()) return;
    if (step === 1) ensureDraftsForSelected();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  function submit() {
    if (!validateStep()) return;
    if (!tenderId) return;

    startTransition(async () => {
      try {
        for (const type of selectedTypes) {
          const draft = drafts[type]!;
          const amount = Number(String(draft.amount).replace(/,/g, ""));
          const formData = new FormData();
          formData.set("tenderId", tenderId);
          formData.set("feeType", type);
          formData.set("amount", String(amount));
          formData.set("status", draft.status);
          if (draft.paymentMode) formData.set("paymentMode", draft.paymentMode);
          if (draft.paymentDate) formData.set("paymentDate", draft.paymentDate);
          if (draft.dueDate) formData.set("dueDate", draft.dueDate);
          formData.set("refundable", draft.refundable ? "true" : "false");
          if (draft.notes.trim()) formData.set("notes", draft.notes.trim());
          formData.set(
            "paymentReference",
            JSON.stringify(draft.paymentReference || {}),
          );

          const ref = draft.paymentReference || {};
          if (type === "pbg" || draft.paymentMode === "bank_guarantee") {
            const bgNo = typeof ref.bgNo === "string" ? ref.bgNo : "";
            const bank = typeof ref.bank === "string" ? ref.bank : "";
            const issueDate =
              typeof ref.issueDate === "string" ? ref.issueDate : "";
            const expiryDate =
              typeof ref.expiryDate === "string" ? ref.expiryDate : "";
            const claimPeriod =
              typeof ref.claimPeriod === "string" ? ref.claimPeriod : "";
            const urn = typeof ref.urn === "string" ? ref.urn : "";
            if (bgNo) formData.set("bgNumber", bgNo);
            if (bank) formData.set("bankName", bank);
            if (issueDate) formData.set("issueDate", issueDate);
            if (expiryDate) formData.set("expiryDate", expiryDate);
            if (claimPeriod) formData.set("claimPeriodDays", claimPeriod);
            if (urn) formData.set("urn", urn);
            if (type === "pbg") formData.set("pbgStatus", "active");
          }

          for (const file of draft.files) {
            formData.append("files", file);
          }

          const result = await createBidFeeWithAttachmentsAction(formData);
          if (!result.ok) {
            setError(result.error);
            toast.error(result.error);
            return;
          }
        }

        toast.success(
          selectedTypes.length === 1
            ? "Fee saved."
            : `${selectedTypes.length} fees saved.`,
        );
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unable to save fees.";
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-[min(840px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
      >
        <DialogHeader className="sticky top-0 z-10 shrink-0 border-b border-border bg-card px-6 py-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground-900">
                Add Bid Fee
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-sm text-foreground-500">
                Step {step + 1} of {STEPS.length}: {STEPS[step]}
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

          <div className="mt-3 flex gap-1.5">
            {STEPS.map((label, index) => (
              <div
                key={label}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  index <= step ? "bg-primary" : "bg-slate-200",
                )}
              />
            ))}
          </div>

          {error ? (
            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {step === 0 ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-500" />
                <Input
                  className="pl-9"
                  placeholder="Search tenders by title, reference, org…"
                  value={tenderQuery}
                  onChange={(e) => setTenderQuery(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-lg border border-border">
                {filteredTenders.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-foreground-500">
                    No eligible tenders found.
                  </p>
                ) : (
                  filteredTenders.map((t) => {
                    const selected = tenderId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={pending}
                        onClick={() => setTenderId(t.id)}
                        className={cn(
                          "flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left last:border-b-0",
                          selected
                            ? "bg-primary/5"
                            : "hover:bg-surface-muted/60",
                        )}
                      >
                        <span className="text-sm font-medium text-foreground-900">
                          {t.title}
                        </span>
                        <span className="text-xs text-foreground-500">
                          {[t.referenceNo || t.sourceTenderId, t.organization]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {t.emdAmount != null ? (
                          <span className="text-xs text-foreground-500">
                            EMD {formatIndianCurrency(t.emdAmount)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground-500">
                Select one or more fee types for{" "}
                <span className="font-medium text-foreground-900">
                  {selectedTender ? tenderLabel(selectedTender) : "tender"}
                </span>
                .
              </p>
              <div className="space-y-2">
                {BID_FEE_TYPES.map((type) => {
                  const checked = selectedTypes.includes(type);
                  const suggestion = resolvedSuggestions[type];
                  return (
                    <label
                      key={type}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3",
                        checked ? "bg-primary/5" : "bg-card",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={pending}
                        onCheckedChange={() => toggleType(type)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground-900">
                          {BID_FEE_TYPE_LABELS[type]}
                        </div>
                        {suggestion != null && suggestion > 0 ? (
                          <div className="text-xs text-foreground-500">
                            Suggested: {formatIndianCurrency(suggestion)}
                          </div>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-6">
              {selectedTypes.map((type) => {
                const draft = drafts[type] || emptyDraft(resolvedSuggestions[type]);
                return (
                  <section
                    key={type}
                    className="space-y-3 rounded-lg border border-border bg-card p-4"
                  >
                    <h3 className="text-sm font-semibold text-foreground-900">
                      {BID_FEE_TYPE_LABELS[type]}
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Amount (INR) *</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={draft.amount}
                          disabled={pending}
                          onChange={(e) =>
                            updateDraft(type, { amount: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Status *</Label>
                        <Select
                          value={draft.status}
                          disabled={pending}
                          onValueChange={(v) =>
                            updateDraft(type, { status: v as BidFeeStatus })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BID_FEE_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {BID_FEE_STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Payment Mode</Label>
                        <Select
                          value={draft.paymentMode || undefined}
                          disabled={pending}
                          onValueChange={(v) =>
                            updateDraft(type, {
                              paymentMode: v as PaymentMode,
                              paymentReference: {},
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select mode" />
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_MODES.map((m) => (
                              <SelectItem key={m} value={m}>
                                {PAYMENT_MODE_LABELS[m]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Payment Date</Label>
                        <Input
                          type="date"
                          value={draft.paymentDate}
                          disabled={pending}
                          onChange={(e) =>
                            updateDraft(type, { paymentDate: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Due Date</Label>
                        <Input
                          type="date"
                          value={draft.dueDate}
                          disabled={pending}
                          onChange={(e) =>
                            updateDraft(type, { dueDate: e.target.value })
                          }
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-6">
                        <Checkbox
                          id={`refundable-${type}`}
                          checked={draft.refundable}
                          disabled={pending}
                          onCheckedChange={(checked) =>
                            updateDraft(type, {
                              refundable: checked === true,
                            })
                          }
                        />
                        <Label
                          htmlFor={`refundable-${type}`}
                          className="font-normal"
                        >
                          Refundable
                        </Label>
                      </div>
                    </div>

                    {draft.paymentMode ? (
                      <PaymentModeFields
                        mode={draft.paymentMode}
                        value={draft.paymentReference}
                        disabled={pending}
                        idPrefix={`${type}-pay`}
                        onChange={(paymentReference) =>
                          updateDraft(type, { paymentReference })
                        }
                      />
                    ) : null}

                    <div className="space-y-1.5">
                      <Label>Notes</Label>
                      <Textarea
                        value={draft.notes}
                        disabled={pending}
                        rows={2}
                        onChange={(e) =>
                          updateDraft(type, { notes: e.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Attachment *</Label>
                      <Input
                        type="file"
                        multiple
                        disabled={pending}
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                        onChange={(e) =>
                          updateDraft(type, {
                            files: Array.from(e.target.files || []),
                          })
                        }
                      />
                      {draft.files.length > 0 ? (
                        <p className="text-xs text-foreground-500">
                          {draft.files.length} file(s) selected
                        </p>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-surface-muted/40 px-4 py-3 text-sm">
                <div className="font-medium text-foreground-900">
                  {selectedTender ? tenderLabel(selectedTender) : "—"}
                </div>
                {selectedTender?.organization ? (
                  <div className="text-xs text-foreground-500">
                    {selectedTender.organization}
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                {selectedTypes.map((type) => {
                  const draft = drafts[type]!;
                  const amount = Number(String(draft.amount).replace(/,/g, ""));
                  return (
                    <div
                      key={type}
                      className="rounded-lg border border-border px-4 py-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground-900">
                          {BID_FEE_TYPE_LABELS[type]}
                        </span>
                        <span className="font-medium">
                          {formatIndianCurrency(amount)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-foreground-500">
                        {BID_FEE_STATUS_LABELS[draft.status]}
                        {draft.paymentMode
                          ? ` · ${PAYMENT_MODE_LABELS[draft.paymentMode]}`
                          : ""}
                        {draft.refundable ? " · Refundable" : ""}
                        {` · ${draft.files.length} attachment(s)`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-card px-6 py-4 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={pending || step === 0}
            onClick={goBack}
          >
            Back
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" disabled={pending} onClick={goNext}>
                Next
              </Button>
            ) : (
              <Button type="button" disabled={pending} onClick={submit}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Submit"
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
