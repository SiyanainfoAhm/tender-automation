"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { updateBidPreferencesAction } from "@/server/actions/company";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const QUICK_SERVICES = [
  "Information Technology",
  "Software Development",
  "System Integration",
  "Networking",
  "Cloud Services",
  "Cybersecurity",
];

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
  const [services, setServices] = useState(initial.serviceScope);
  const [customService, setCustomService] = useState("");

  useEffect(() => {
    if (state?.ok) toast.success("Bid preferences saved");
    if (state?.error) toast.error(state.error);
  }, [state]);

  function addService(value: string) {
    const v = value.trim();
    if (!v || services.includes(v)) return;
    setServices((prev) => [...prev, v]);
    setCustomService("");
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="serviceScope" value={services.join("\n")} />

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

      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
          Service Scope
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {QUICK_SERVICES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addService(s)}
                className="rounded-full border border-border bg-white px-2.5 py-1 text-xs text-text-secondary hover:border-primary/40 hover:text-primary"
              >
                + {s}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {services.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700"
            >
              {s}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`Remove ${s}`}
                  onClick={() =>
                    setServices((prev) => prev.filter((x) => x !== s))
                  }
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
          {services.length === 0 ? (
            <span className="text-xs text-text-muted">No services selected</span>
          ) : null}
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <Input
              placeholder="Add custom service"
              value={customService}
              onChange={(e) => setCustomService(e.target.value)}
              disabled={pending}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => addService(customService)}
              disabled={pending}
            >
              Add
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
          Excluded Scope
        </p>
        <Textarea
          name="excludedScope"
          rows={3}
          placeholder="One exclusion per line"
          defaultValue={initial.excludedScope.join("\n")}
          disabled={!canEdit || pending}
        />
      </section>

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
