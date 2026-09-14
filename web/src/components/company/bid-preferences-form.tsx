"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateBidPreferencesAction } from "@/server/actions/company";
import { ScopeChipField } from "@/components/company/scope-chip-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_EXCLUDED_SCOPE_SUGGESTIONS,
  DEFAULT_SERVICE_SCOPE_SUGGESTIONS,
  parseStoredScopeList,
} from "@/lib/company/scope-chips";
import type { ScreeningPolicy } from "@/lib/company/screening-policies";
import {
  SCREENING_POLICY_FIELDS,
  SCREENING_POLICY_VALUES,
  type ScreeningPolicies,
} from "@/lib/company/screening-policies";

type BidPreferencesFormProps = {
  canEdit: boolean;
  initial: {
    maxEmdInr: string;
    minTenderValueInr: string;
    maxTenderValueInr: string;
    minBidLeadDays: string;
    serviceScope: string[];
    excludedScope: string[];
    screeningPolicies?: ScreeningPolicies;
  };
};

function scopesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function policiesEqual(
  a: ScreeningPolicies | undefined,
  b: ScreeningPolicies | undefined,
): boolean {
  const keys = new Set([
    ...Object.keys(a || {}),
    ...Object.keys(b || {}),
  ] as Array<keyof ScreeningPolicies>);
  for (const key of keys) {
    if ((a?.[key] || "") !== (b?.[key] || "")) return false;
  }
  return true;
}

export function BidPreferencesForm({
  canEdit,
  initial,
}: BidPreferencesFormProps) {
  const [state, formAction, pending] = useActionState(
    updateBidPreferencesAction,
    {},
  );
  const [maxEmdInr, setMaxEmdInr] = useState(initial.maxEmdInr);
  const [minTenderValueInr, setMinTenderValueInr] = useState(
    initial.minTenderValueInr,
  );
  const [maxTenderValueInr, setMaxTenderValueInr] = useState(
    initial.maxTenderValueInr,
  );
  const [minBidLeadDays, setMinBidLeadDays] = useState(initial.minBidLeadDays);
  const [selectedServices, setSelectedServices] = useState(() =>
    parseStoredScopeList(initial.serviceScope),
  );
  const [selectedExcludedScopes, setSelectedExcludedScopes] = useState(() =>
    parseStoredScopeList(initial.excludedScope),
  );
  const [screeningPolicies, setScreeningPolicies] = useState<ScreeningPolicies>(
    () => ({ ...(initial.screeningPolicies || {}) }),
  );

  const minExceedsMax =
    minTenderValueInr.trim() !== "" &&
    maxTenderValueInr.trim() !== "" &&
    Number(minTenderValueInr) > Number(maxTenderValueInr);

  const leadDaysInvalid =
    minBidLeadDays.trim() !== "" &&
    (!/^\d+$/.test(minBidLeadDays.trim()) || Number(minBidLeadDays) < 0);

  const dirty = useMemo(() => {
    return (
      maxEmdInr !== initial.maxEmdInr ||
      minTenderValueInr !== initial.minTenderValueInr ||
      maxTenderValueInr !== initial.maxTenderValueInr ||
      minBidLeadDays !== initial.minBidLeadDays ||
      !scopesEqual(selectedServices, parseStoredScopeList(initial.serviceScope)) ||
      !scopesEqual(
        selectedExcludedScopes,
        parseStoredScopeList(initial.excludedScope),
      ) ||
      !policiesEqual(screeningPolicies, initial.screeningPolicies)
    );
  }, [
    maxEmdInr,
    minTenderValueInr,
    maxTenderValueInr,
    minBidLeadDays,
    selectedServices,
    selectedExcludedScopes,
    screeningPolicies,
    initial,
  ]);

  useEffect(() => {
    if (state?.ok) toast.success("Bid preferences saved");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="space-y-6">
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
          Financial Preferences
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="maxEmdInr">Maximum EMD (INR)</Label>
            <Input
              id="maxEmdInr"
              name="maxEmdInr"
              type="number"
              min={0}
              step={1}
              value={maxEmdInr}
              onChange={(e) => setMaxEmdInr(e.target.value)}
              disabled={!canEdit || pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="minTenderValueInr">Minimum Tender Value (INR)</Label>
            <Input
              id="minTenderValueInr"
              name="minTenderValueInr"
              type="number"
              min={0}
              step={1}
              value={minTenderValueInr}
              onChange={(e) => setMinTenderValueInr(e.target.value)}
              disabled={!canEdit || pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxTenderValueInr">Maximum Tender Value (INR)</Label>
            <Input
              id="maxTenderValueInr"
              name="maxTenderValueInr"
              type="number"
              min={0}
              step={1}
              value={maxTenderValueInr}
              onChange={(e) => setMaxTenderValueInr(e.target.value)}
              disabled={!canEdit || pending}
            />
          </div>
        </div>
        {minExceedsMax ? (
          <p className="text-xs text-red-600" role="alert">
            Minimum tender value cannot exceed maximum tender value.
          </p>
        ) : null}
        <p className="text-[11px] text-text-muted">
          Leave a field empty for no limit on that criterion.
        </p>
      </section>

      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
          Minimum Bid Lead Time
        </p>
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="minBidLeadDays">Days remaining before closing</Label>
          <Input
            id="minBidLeadDays"
            name="minBidLeadDays"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="e.g. 2"
            value={minBidLeadDays}
            onChange={(e) => setMinBidLeadDays(e.target.value)}
            disabled={!canEdit || pending}
          />
          <p className="text-[11px] text-text-muted">
            Tenders with this many calendar days or fewer until closing are not
            eligible to bid. Leave empty to use the system default.
          </p>
          {leadDaysInvalid ? (
            <p className="text-xs text-red-600" role="alert">
              Enter zero or a positive whole number of days.
            </p>
          ) : null}
        </div>
      </section>

      <ScopeChipField
        label="Service Scope"
        hiddenName="serviceScope"
        canEdit={canEdit}
        pending={pending}
        defaultSuggestions={DEFAULT_SERVICE_SCOPE_SUGGESTIONS}
        selected={selectedServices}
        onSelectedChange={setSelectedServices}
        customPlaceholder="Add custom service"
        emptyLabel="No services selected"
      />

      <ScopeChipField
        label="Excluded Scope"
        hiddenName="excludedScope"
        canEdit={canEdit}
        pending={pending}
        defaultSuggestions={DEFAULT_EXCLUDED_SCOPE_SUGGESTIONS}
        selected={selectedExcludedScopes}
        onSelectedChange={setSelectedExcludedScopes}
        customPlaceholder="Add custom excluded scope"
        emptyLabel="No exclusions selected"
      />

      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
          Phase-1 screening policies
        </p>
        <p className="text-[11px] text-text-muted">
          Optional. Leave unset to omit the rule from ChatGPT. Saved values
          are the only company decisions used at screening time.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {SCREENING_POLICY_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`screeningPolicy.${field.key}`}>{field.label}</Label>
              <select
                id={`screeningPolicy.${field.key}`}
                name={`screeningPolicy.${field.key}`}
                value={screeningPolicies[field.key] ?? ""}
                onChange={(e) =>
                  setScreeningPolicies((prev) => {
                    const next = { ...prev };
                    const value = e.target.value as ScreeningPolicy | "";
                    if (!value) {
                      delete next[field.key];
                    } else {
                      next[field.key] = value;
                    }
                    return next;
                  })
                }
                disabled={!canEdit || pending}
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 text-sm"
              >
                <option value="">Not configured</option>
                {SCREENING_POLICY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      {canEdit ? (
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={pending || !dirty || minExceedsMax || leadDaysInvalid}
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
