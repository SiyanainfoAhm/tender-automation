"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateCompanyProfileAction } from "@/server/actions/company";
import { FieldValidationHint } from "@/components/auth/validation-hints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getYearEstablishedValidationStatus } from "@/lib/validations/phone-rules";

type CompanyGeneralInfoFormProps = {
  canEdit: boolean;
  initial: {
    name: string;
    industryType: string;
    businessLocation: string;
    website: string;
    yearEstablished: string;
    description: string;
  };
};

export function CompanyGeneralInfoForm({
  canEdit,
  initial,
}: CompanyGeneralInfoFormProps) {
  const [state, formAction, pending] = useActionState(
    updateCompanyProfileAction,
    {},
  );
  const [yearEstablished, setYearEstablished] = useState(
    initial.yearEstablished,
  );
  const [yearTouched, setYearTouched] = useState(false);
  const yearStatus = getYearEstablishedValidationStatus(yearEstablished);

  useEffect(() => {
    if (state?.ok) toast.success("Company profile saved");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
          Company Information
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="name">Company Name *</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={initial.name}
            disabled={!canEdit || pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="industryType">Industry Type *</Label>
          <Input
            id="industryType"
            name="industryType"
            required
            defaultValue={initial.industryType}
            disabled={!canEdit || pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="businessLocation">Business Location *</Label>
          <Input
            id="businessLocation"
            name="businessLocation"
            required
            defaultValue={initial.businessLocation}
            disabled={!canEdit || pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            name="website"
            type="url"
            placeholder="https://example.com"
            defaultValue={initial.website}
            disabled={!canEdit || pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="yearEstablished">Year Established</Label>
          <Input
            id="yearEstablished"
            name="yearEstablished"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            placeholder="e.g. 2015"
            value={yearEstablished}
            onChange={(e) => setYearEstablished(e.target.value)}
            onBlur={() => setYearTouched(true)}
            disabled={!canEdit || pending}
          />
          <FieldValidationHint
            show={yearTouched && yearStatus !== null}
            valid={yearStatus?.valid ?? false}
            validMessage={yearStatus?.message ?? "Valid year"}
            invalidMessage={
              yearStatus?.message ?? "Enter a valid 4-digit year"
            }
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">Company Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={initial.description}
            disabled={!canEdit || pending}
          />
        </div>
      </div>

      {canEdit ? (
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={
              pending || (yearStatus != null && yearStatus.valid === false)
            }
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
      ) : (
        <p className="text-xs text-text-muted">
          Read-only — company admins can edit this profile.
        </p>
      )}
    </form>
  );
}
