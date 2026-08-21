"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PaymentMode } from "@/lib/bid-fees";

export type PaymentReferenceState = Record<string, string | boolean>;

type PaymentModeFieldsProps = {
  mode: PaymentMode | "";
  value: PaymentReferenceState;
  onChange: (next: PaymentReferenceState) => void;
  disabled?: boolean;
  idPrefix?: string;
};

function setField(
  value: PaymentReferenceState,
  onChange: (next: PaymentReferenceState) => void,
  key: string,
  nextValue: string | boolean,
) {
  onChange({ ...value, [key]: nextValue });
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function TextInput({
  id,
  value,
  onChange,
  disabled,
  type = "text",
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <Input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function str(value: PaymentReferenceState, key: string): string {
  const v = value[key];
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export function PaymentModeFields({
  mode,
  value,
  onChange,
  disabled,
  idPrefix = "pay",
}: PaymentModeFieldsProps) {
  if (!mode) return null;

  const pid = (key: string) => `${idPrefix}-${key}`;

  if (mode === "neft_rtgs") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={pid("utr")} label="UTR / Transaction ID">
          <TextInput
            id={pid("utr")}
            value={str(value, "utr")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "utr", v)}
          />
        </Field>
        <Field id={pid("bank")} label="Bank">
          <TextInput
            id={pid("bank")}
            value={str(value, "bank")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "bank", v)}
          />
        </Field>
        <Field id={pid("ifsc")} label="IFSC">
          <TextInput
            id={pid("ifsc")}
            value={str(value, "ifsc")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "ifsc", v)}
          />
        </Field>
        <Field id={pid("txnDate")} label="Transaction Date">
          <TextInput
            id={pid("txnDate")}
            type="date"
            value={str(value, "txnDate")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "txnDate", v)}
          />
        </Field>
      </div>
    );
  }

  if (mode === "netbanking_upi") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={pid("gatewayRef")} label="Gateway / UPI Reference">
          <TextInput
            id={pid("gatewayRef")}
            value={str(value, "gatewayRef")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "gatewayRef", v)}
          />
        </Field>
        <Field id={pid("txnDate")} label="Transaction Date">
          <TextInput
            id={pid("txnDate")}
            type="date"
            value={str(value, "txnDate")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "txnDate", v)}
          />
        </Field>
      </div>
    );
  }

  if (mode === "dd") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={pid("ddNo")} label="DD / Cheque No">
          <TextInput
            id={pid("ddNo")}
            value={str(value, "ddNo")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "ddNo", v)}
          />
        </Field>
        <Field id={pid("issuingBank")} label="Issuing Bank">
          <TextInput
            id={pid("issuingBank")}
            value={str(value, "issuingBank")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "issuingBank", v)}
          />
        </Field>
        <Field id={pid("payableAt")} label="Payable At">
          <TextInput
            id={pid("payableAt")}
            value={str(value, "payableAt")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "payableAt", v)}
          />
        </Field>
        <Field id={pid("issueDate")} label="Issue Date">
          <TextInput
            id={pid("issueDate")}
            type="date"
            value={str(value, "issueDate")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "issueDate", v)}
          />
        </Field>
        <Field id={pid("expiryDate")} label="Expiry Date">
          <TextInput
            id={pid("expiryDate")}
            type="date"
            value={str(value, "expiryDate")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "expiryDate", v)}
          />
        </Field>
      </div>
    );
  }

  if (mode === "fdr") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={pid("fdrNo")} label="FDR Number">
          <TextInput
            id={pid("fdrNo")}
            value={str(value, "fdrNo")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "fdrNo", v)}
          />
        </Field>
        <Field id={pid("bank")} label="Bank">
          <TextInput
            id={pid("bank")}
            value={str(value, "bank")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "bank", v)}
          />
        </Field>
        <Field id={pid("issueDate")} label="Issue Date">
          <TextInput
            id={pid("issueDate")}
            type="date"
            value={str(value, "issueDate")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "issueDate", v)}
          />
        </Field>
        <Field id={pid("maturityDate")} label="Maturity Date">
          <TextInput
            id={pid("maturityDate")}
            type="date"
            value={str(value, "maturityDate")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "maturityDate", v)}
          />
        </Field>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Checkbox
            id={pid("lienMarked")}
            checked={Boolean(value.lienMarked)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              setField(value, onChange, "lienMarked", checked === true)
            }
          />
          <Label htmlFor={pid("lienMarked")} className="font-normal">
            Lien marked
          </Label>
        </div>
      </div>
    );
  }

  if (mode === "bank_guarantee") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={pid("bgNo")} label="BG Number">
          <TextInput
            id={pid("bgNo")}
            value={str(value, "bgNo")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "bgNo", v)}
          />
        </Field>
        <Field id={pid("bank")} label="Bank">
          <TextInput
            id={pid("bank")}
            value={str(value, "bank")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "bank", v)}
          />
        </Field>
        <Field id={pid("bgAmount")} label="BG Amount">
          <TextInput
            id={pid("bgAmount")}
            type="number"
            value={str(value, "bgAmount")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "bgAmount", v)}
          />
        </Field>
        <Field id={pid("urn")} label="URN">
          <TextInput
            id={pid("urn")}
            value={str(value, "urn")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "urn", v)}
          />
        </Field>
        <Field id={pid("issueDate")} label="Issue Date">
          <TextInput
            id={pid("issueDate")}
            type="date"
            value={str(value, "issueDate")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "issueDate", v)}
          />
        </Field>
        <Field id={pid("expiryDate")} label="Expiry Date">
          <TextInput
            id={pid("expiryDate")}
            type="date"
            value={str(value, "expiryDate")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "expiryDate", v)}
          />
        </Field>
        <Field id={pid("claimPeriod")} label="Claim Period (days)">
          <TextInput
            id={pid("claimPeriod")}
            type="number"
            value={str(value, "claimPeriod")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "claimPeriod", v)}
          />
        </Field>
      </div>
    );
  }

  if (mode === "cash_other") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={pid("receiptNo")} label="Receipt Number">
          <TextInput
            id={pid("receiptNo")}
            value={str(value, "receiptNo")}
            disabled={disabled}
            onChange={(v) => setField(value, onChange, "receiptNo", v)}
          />
        </Field>
      </div>
    );
  }

  return null;
}
