"use client";

import { useActionState, useEffect, useState } from "react";
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

type BidPreferencesFormProps = {
  canEdit: boolean;
  initial: {
    maxEmdInr: string;
    minTenderValueInr: string;
    maxTenderValueInr: string;
    serviceScope: string[];
    excludedScope: string[];
  };
};

export function BidPreferencesForm({
  canEdit,
  initial,
}: BidPreferencesFormProps) {
  const [state, formAction, pending] = useActionState(
    updateBidPreferencesAction,
    {},
  );
  const [selectedServices, setSelectedServices] = useState(() =>
    parseStoredScopeList(initial.serviceScope),
  );
  const [selectedExcludedScopes, setSelectedExcludedScopes] = useState(() =>
    parseStoredScopeList(initial.excludedScope),
  );

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
              defaultValue={initial.maxEmdInr}
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
              defaultValue={initial.minTenderValueInr}
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
              defaultValue={initial.maxTenderValueInr}
              disabled={!canEdit || pending}
            />
          </div>
        </div>
        <p className="text-[11px] text-text-muted">
          Defaults follow the project&apos;s screening configuration (not
          screenshot demo values).
        </p>
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

      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
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
