"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, Trash2, X } from "lucide-react";
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
  BID_FEE_STATUS_LABELS,
  BID_FEE_STATUSES,
  BID_FEE_TYPE_LABELS,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  formatFileSize,
  type BidFeeRecord,
  type BidFeeStatus,
  type PaymentMode,
  type TenderDocumentRecord,
} from "@/lib/bid-fees";
import { formatDate, formatIndianCurrency } from "@/lib/format";
import {
  attachFeeDocumentAction,
  deleteTenderDocumentAction,
  updateBidFeeAction,
} from "@/server/actions/bid-fees";

type FeeModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fee: BidFeeRecord | null;
  attachments: TenderDocumentRecord[];
  canEdit?: boolean;
};

function toPaymentRef(fee: BidFeeRecord | null): PaymentReferenceState {
  if (!fee) return {};
  const ref = fee.paymentReference || {};
  const out: PaymentReferenceState = {};
  for (const [k, v] of Object.entries(ref)) {
    if (typeof v === "boolean") out[k] = v;
    else if (v == null) continue;
    else out[k] = String(v);
  }
  if (fee.bgNumber && out.bgNo == null) out.bgNo = fee.bgNumber;
  if (fee.bankName && out.bank == null) out.bank = fee.bankName;
  if (fee.issueDate && out.issueDate == null) out.issueDate = fee.issueDate;
  if (fee.expiryDate && out.expiryDate == null) out.expiryDate = fee.expiryDate;
  if (fee.claimPeriodDays != null && out.claimPeriod == null) {
    out.claimPeriod = String(fee.claimPeriodDays);
  }
  if (fee.urn && out.urn == null) out.urn = fee.urn;
  return out;
}

export function FeeModal({
  open,
  onOpenChange,
  fee,
  attachments,
  canEdit = true,
}: FeeModalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<BidFeeStatus>("pending");
  const [paymentMode, setPaymentMode] = useState<PaymentMode | "">("");
  const [paymentReference, setPaymentReference] =
    useState<PaymentReferenceState>({});
  const [paymentDate, setPaymentDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [refundable, setRefundable] = useState(false);
  const [notes, setNotes] = useState("");
  const [attachFile, setAttachFile] = useState<File | null>(null);

  const feeAttachments = useMemo(
    () => (fee ? attachments.filter((d) => d.feeId === fee.id) : []),
    [attachments, fee],
  );

  useEffect(() => {
    if (!fee || !open) return;
    setEditing(false);
    setAmount(String(fee.amount));
    setStatus(fee.status);
    setPaymentMode(fee.paymentMode || "");
    setPaymentReference(toPaymentRef(fee));
    setPaymentDate(fee.paymentDate || "");
    setDueDate(fee.dueDate || "");
    setRefundable(fee.refundable);
    setNotes(fee.notes || "");
    setAttachFile(null);
  }, [fee, open]);

  function save() {
    if (!fee) return;
    const parsed = Number(String(amount).replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Enter a valid amount.");
      return;
    }

    startTransition(async () => {
      const result = await updateBidFeeAction(fee.id, {
        amount: parsed,
        status,
        paymentMode: paymentMode || null,
        paymentDate: paymentDate || null,
        dueDate: dueDate || null,
        refundable,
        notes: notes.trim() || null,
        paymentReference,
        bgNumber:
          typeof paymentReference.bgNo === "string"
            ? paymentReference.bgNo
            : fee.bgNumber,
        bankName:
          typeof paymentReference.bank === "string"
            ? paymentReference.bank
            : fee.bankName,
        issueDate:
          typeof paymentReference.issueDate === "string"
            ? paymentReference.issueDate
            : fee.issueDate,
        expiryDate:
          typeof paymentReference.expiryDate === "string"
            ? paymentReference.expiryDate
            : fee.expiryDate,
        claimPeriodDays:
          typeof paymentReference.claimPeriod === "string" &&
          paymentReference.claimPeriod
            ? Number(paymentReference.claimPeriod)
            : fee.claimPeriodDays,
        urn:
          typeof paymentReference.urn === "string"
            ? paymentReference.urn
            : fee.urn,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Fee updated.");
      setEditing(false);
      router.refresh();
    });
  }

  function attach() {
    if (!fee || !attachFile) {
      toast.error("Choose a file to upload.");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("feeId", fee.id);
      formData.set("file", attachFile);
      const result = await attachFeeDocumentAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Attachment uploaded.");
      setAttachFile(null);
      router.refresh();
    });
  }

  function removeAttachment(documentId: string, name: string) {
    if (!confirm(`Delete attachment “${name}”?`)) return;
    startTransition(async () => {
      const result = await deleteTenderDocumentAction(documentId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Attachment deleted.");
      router.refresh();
    });
  }

  if (!fee) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-[min(720px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
      >
        <DialogHeader className="sticky top-0 z-10 shrink-0 border-b border-border bg-card px-6 py-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground-900">
                {BID_FEE_TYPE_LABELS[fee.feeType]}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-sm text-foreground-500">
                {fee.tenderTitle || "Tender fee details"}
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
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Amount (INR)</Label>
              {editing ? (
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  disabled={pending}
                  onChange={(e) => setAmount(e.target.value)}
                />
              ) : (
                <p className="text-sm font-medium">
                  {formatIndianCurrency(fee.amount)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              {editing ? (
                <Select
                  value={status}
                  disabled={pending}
                  onValueChange={(v) => setStatus(v as BidFeeStatus)}
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
              ) : (
                <p className="text-sm">{BID_FEE_STATUS_LABELS[fee.status]}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Payment Mode</Label>
              {editing ? (
                <Select
                  value={paymentMode || undefined}
                  disabled={pending}
                  onValueChange={(v) => {
                    setPaymentMode(v as PaymentMode);
                    setPaymentReference({});
                  }}
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
              ) : (
                <p className="text-sm">
                  {fee.paymentMode
                    ? PAYMENT_MODE_LABELS[fee.paymentMode]
                    : "—"}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Payment Date</Label>
              {editing ? (
                <Input
                  type="date"
                  value={paymentDate}
                  disabled={pending}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              ) : (
                <p className="text-sm">{formatDate(fee.paymentDate)}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              {editing ? (
                <Input
                  type="date"
                  value={dueDate}
                  disabled={pending}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              ) : (
                <p className="text-sm">{formatDate(fee.dueDate)}</p>
              )}
            </div>
            <div className="flex items-center gap-2 pt-6">
              {editing ? (
                <>
                  <Checkbox
                    id="fee-refundable"
                    checked={refundable}
                    disabled={pending}
                    onCheckedChange={(checked) =>
                      setRefundable(checked === true)
                    }
                  />
                  <Label htmlFor="fee-refundable" className="font-normal">
                    Refundable
                  </Label>
                </>
              ) : (
                <p className="text-sm">
                  {fee.refundable ? "Refundable" : "Non-refundable"}
                </p>
              )}
            </div>
          </div>

          {editing && paymentMode ? (
            <PaymentModeFields
              mode={paymentMode}
              value={paymentReference}
              disabled={pending}
              idPrefix="fee-edit"
              onChange={setPaymentReference}
            />
          ) : null}

          {!editing && fee.paymentMode === "bank_guarantee" ? (
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-surface-muted/40 px-4 py-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-foreground-500">BG No: </span>
                {fee.bgNumber || "—"}
              </div>
              <div>
                <span className="text-foreground-500">Bank: </span>
                {fee.bankName || "—"}
              </div>
              <div>
                <span className="text-foreground-500">Issue: </span>
                {formatDate(fee.issueDate)}
              </div>
              <div>
                <span className="text-foreground-500">Expiry: </span>
                {formatDate(fee.expiryDate)}
              </div>
              <div>
                <span className="text-foreground-500">URN: </span>
                {fee.urn || "—"}
              </div>
              <div>
                <span className="text-foreground-500">Claim period: </span>
                {fee.claimPeriodDays != null
                  ? `${fee.claimPeriodDays} days`
                  : "—"}
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Notes</Label>
            {editing ? (
              <Textarea
                value={notes}
                disabled={pending}
                rows={3}
                onChange={(e) => setNotes(e.target.value)}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-foreground-700">
                {fee.notes || "—"}
              </p>
            )}
          </div>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground-900">
              Attachments
            </h3>
            {feeAttachments.length === 0 ? (
              <p className="text-sm text-foreground-500">No attachments yet.</p>
            ) : (
              <ul className="space-y-2">
                {feeAttachments.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {doc.originalName || doc.fileName}
                      </div>
                      <div className="text-xs text-foreground-500">
                        {formatFileSize(doc.fileSizeBytes)} ·{" "}
                        {formatDate(doc.createdAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {doc.downloadUrl ? (
                        <Button variant="outline" size="sm" asChild>
                          <a href={doc.downloadUrl} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-rose-600"
                          disabled={pending}
                          aria-label="Delete attachment"
                          onClick={() =>
                            removeAttachment(
                              doc.id,
                              doc.originalName || doc.fileName,
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {canEdit ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="fee-attach">Add attachment</Label>
                  <Input
                    id="fee-attach"
                    type="file"
                    disabled={pending}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                    onChange={(e) =>
                      setAttachFile(e.target.files?.[0] || null)
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || !attachFile}
                  onClick={attach}
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Paperclip className="size-4" />
                  )}
                  Upload
                </Button>
              </div>
            ) : null}
          </section>
        </div>

        <DialogFooter className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-card px-6 py-4 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {canEdit ? (
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="button" disabled={pending} onClick={save}>
                    {pending ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      "Save changes"
                    )}
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </div>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
