"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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
  const [name, setName] = useState(initial.name);
  const [industryType, setIndustryType] = useState(initial.industryType);
  const [businessLocation, setBusinessLocation] = useState(
    initial.businessLocation,
  );
  const [website, setWebsite] = useState(initial.website);
  const [yearEstablished, setYearEstablished] = useState(
    initial.yearEstablished,
  );
  const [description, setDescription] = useState(initial.description);
  const [yearTouched, setYearTouched] = useState(false);
  const yearStatus = getYearEstablishedValidationStatus(yearEstablished);

  const dirty = useMemo(
    () =>
      name !== initial.name ||
      industryType !== initial.industryType ||
      businessLocation !== initial.businessLocation ||
      website !== initial.website ||
      yearEstablished !== initial.yearEstablished ||
      description !== initial.description,
    [
      name,
      industryType,
      businessLocation,
      website,
      yearEstablished,
      description,
      initial,
    ],
  );

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
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit || pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="industryType">Industry Type *</Label>
          <Input
            id="industryType"
            name="industryType"
            required
            value={industryType}
            onChange={(e) => setIndustryType(e.target.value)}
            disabled={!canEdit || pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="businessLocation">Business Location *</Label>
          <Input
            id="businessLocation"
            name="businessLocation"
            required
            value={businessLocation}
            onChange={(e) => setBusinessLocation(e.target.value)}
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
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
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
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit || pending}
          />
        </div>
      </div>

      {canEdit ? (
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={
              pending ||
              !dirty ||
              (yearStatus != null && yearStatus.valid === false)
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
