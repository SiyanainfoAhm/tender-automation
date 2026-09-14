"use client";

import { useActionState, useState } from "react";
import { Building2, Globe, Loader2, MapPin } from "lucide-react";

import { createCompanyAction } from "@/server/actions/company-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneCountryField } from "@/components/ui/phone-country-field";

export function CreateCompanyForm() {
  const [state, formAction, pending] = useActionState(createCompanyAction, {});
  const [phoneValid, setPhoneValid] = useState(true);

  return (
    <form action={formAction} className="mx-auto max-w-lg space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="companyName">Company name *</Label>
        <div className="relative">
          <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
          <Input
            id="companyName"
            name="companyName"
            required
            disabled={pending}
            placeholder="Acme Corp"
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="industry">Industry</Label>
          <Input id="industry" name="industry" disabled={pending} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="companyType">Company type</Label>
          <Input id="companyType" name="companyType" disabled={pending} />
        </div>
      </div>

      <PhoneCountryField
        id="phone"
        name="phone"
        label="Phone"
        disabled={pending}
        defaultCountry="IN"
        onValidityChange={setPhoneValid}
      />

      <div className="space-y-1.5">
        <Label htmlFor="website">Website</Label>
        <div className="relative">
          <Globe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
          <Input
            id="website"
            name="website"
            disabled={pending}
            placeholder="https://"
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="location">Location</Label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
          <Input
            id="location"
            name="location"
            disabled={pending}
            placeholder="City, State"
            className="pl-9"
          />
        </div>
      </div>

      {state?.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={pending || !phoneValid}
        className="min-h-11 w-full"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating…
          </>
        ) : (
          "Create company"
        )}
      </Button>
    </form>
  );
}
