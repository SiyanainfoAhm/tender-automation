"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { formatIndianCurrency } from "@/lib/format";
import { markTenderAsWonAction } from "@/server/actions/won-projects";

type TeamMemberOption = {
  id: string;
  fullName: string;
};

type MarkAsWonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenderId: string;
  tenderTitle: string;
  defaultAwardValue?: number | null;
  teamMembers?: TeamMemberOption[];
  onSuccess?: (result: { wonProjectId: string; projectCode: string }) => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MarkAsWonDialog({
  open,
  onOpenChange,
  tenderId,
  tenderTitle,
  defaultAwardValue,
  teamMembers = [],
  onSuccess,
}: MarkAsWonDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [awardDate, setAwardDate] = useState(todayIso());
  const [finalAwardValue, setFinalAwardValue] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [contractStartDate, setContractStartDate] = useState("");
  const [contractEndDate, setContractEndDate] = useState("");
  const [clientDepartment, setClientDepartment] = useState("");
  const [projectManagerId, setProjectManagerId] = useState("");
  const [pbgApplicable, setPbgApplicable] = useState(false);
  const [pbgAmount, setPbgAmount] = useState("");
  const [pbgExpiryDate, setPbgExpiryDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setAwardDate(todayIso());
    setFinalAwardValue(
      defaultAwardValue != null && Number.isFinite(defaultAwardValue)
        ? String(defaultAwardValue)
        : "",
    );
    setPoNumber("");
    setPoDate("");
    setContractNumber("");
    setContractStartDate("");
    setContractEndDate("");
    setClientDepartment("");
    setProjectManagerId("");
    setPbgApplicable(false);
    setPbgAmount("");
    setPbgExpiryDate("");
    setNotes("");
  }, [open, defaultAwardValue]);

  function submit() {
    const value = Number(finalAwardValue.replace(/,/g, ""));
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter a valid final award value.");
      return;
    }
    if (!awardDate) {
      toast.error("Award date is required.");
      return;
    }

    startTransition(async () => {
      const result = await markTenderAsWonAction({
        tenderId,
        awardDate,
        finalAwardValue: value,
        poNumber: poNumber.trim() || null,
        poDate: poDate || null,
        contractNumber: contractNumber.trim() || null,
        contractStartDate: contractStartDate || null,
        contractEndDate: contractEndDate || null,
        clientDepartment: clientDepartment.trim() || null,
        projectManagerId: projectManagerId || null,
        pbgApplicable,
        pbgAmount: pbgApplicable && pbgAmount ? Number(pbgAmount) : null,
        pbgExpiryDate: pbgApplicable && pbgExpiryDate ? pbgExpiryDate : null,
        notes: notes.trim() || null,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message || "Tender marked as won.");
      onOpenChange(false);
      if (result.wonProjectId && result.projectCode) {
        onSuccess?.({
          wonProjectId: result.wonProjectId,
          projectCode: result.projectCode,
        });
      }
      router.refresh();
      if (result.wonProjectId) {
        router.push(`/won-tenders/${result.wonProjectId}`);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mark Tender as Won</DialogTitle>
          <DialogDescription>
            Record award details for{" "}
            <span className="font-medium text-foreground-800">{tenderTitle}</span>
            . This creates a project execution record and sets tender status to
            Won.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="awardDate">Award Date *</Label>
            <Input
              id="awardDate"
              type="date"
              value={awardDate}
              onChange={(e) => setAwardDate(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="finalAwardValue">
              Final Award Value (INR) *
              {defaultAwardValue != null ? (
                <span className="ml-2 text-xs font-normal text-foreground-500">
                  Tender value: {formatIndianCurrency(defaultAwardValue)}
                </span>
              ) : null}
            </Label>
            <Input
              id="finalAwardValue"
              inputMode="decimal"
              value={finalAwardValue}
              onChange={(e) => setFinalAwardValue(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="poNumber">PO Number</Label>
              <Input
                id="poNumber"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="poDate">PO Date</Label>
              <Input
                id="poDate"
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contractNumber">Contract Number</Label>
            <Input
              id="contractNumber"
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="contractStart">Contract Start</Label>
              <Input
                id="contractStart"
                type="date"
                value={contractStartDate}
                onChange={(e) => setContractStartDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contractEnd">Contract End</Label>
              <Input
                id="contractEnd"
                type="date"
                value={contractEndDate}
                onChange={(e) => setContractEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="clientDepartment">Client Department</Label>
            <Input
              id="clientDepartment"
              value={clientDepartment}
              onChange={(e) => setClientDepartment(e.target.value)}
            />
          </div>
          {teamMembers.length > 0 ? (
            <div className="grid gap-2">
              <Label>Project Manager</Label>
              <Select
                value={projectManagerId || "__none__"}
                onValueChange={(v) =>
                  setProjectManagerId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={pbgApplicable}
                onCheckedChange={(v) => setPbgApplicable(Boolean(v))}
              />
              PBG Applicable
            </label>
            {pbgApplicable ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="pbgAmount">PBG Amount</Label>
                  <Input
                    id="pbgAmount"
                    inputMode="decimal"
                    value={pbgAmount}
                    onChange={(e) => setPbgAmount(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="pbgExpiry">PBG Expiry</Label>
                  <Input
                    id="pbgExpiry"
                    type="date"
                    value={pbgExpiryDate}
                    onChange={(e) => setPbgExpiryDate(e.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wonNotes">Notes</Label>
            <Textarea
              id="wonNotes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Mark as Won"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
