"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { FieldValidationHint } from "@/components/auth/validation-hints";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  PHONE_COUNTRIES,
  detectPhoneCountry,
  formatInternationalPhone,
  getPhoneCountry,
  getPhoneValidationStatus,
  nationalPhoneDigits,
  type PhoneCountryCode,
} from "@/lib/validations/phone-rules";

type PhoneCountryFieldProps = {
  id?: string;
  name?: string;
  label?: string;
  disabled?: boolean;
  defaultValue?: string;
  defaultCountry?: PhoneCountryCode;
  className?: string;
  onValidityChange?: (valid: boolean) => void;
};

export function PhoneCountryField({
  id = "phone",
  name = "phone",
  label = "Phone",
  disabled = false,
  defaultValue = "",
  defaultCountry,
  className,
  onValidityChange,
}: PhoneCountryFieldProps) {
  const initialCountry =
    defaultCountry || detectPhoneCountry(defaultValue) || "IN";
  const [country, setCountry] = useState<PhoneCountryCode>(initialCountry);
  const [national, setNational] = useState(() =>
    nationalPhoneDigits(defaultValue, initialCountry),
  );
  const [touched, setTouched] = useState(false);

  const meta = getPhoneCountry(country);
  const composed = formatInternationalPhone(national, country);
  const status = useMemo(
    () => getPhoneValidationStatus(composed, country),
    [composed, country],
  );

  function updateNational(raw: string) {
    const next = nationalPhoneDigits(raw, country).slice(
      0,
      meta.maxNationalDigits,
    );
    setNational(next);
    const nextComposed = formatInternationalPhone(next, country);
    const nextStatus = getPhoneValidationStatus(nextComposed, country);
    onValidityChange?.(nextStatus == null || nextStatus.valid);
  }

  function changeCountry(next: PhoneCountryCode) {
    const option = getPhoneCountry(next);
    const digits = nationalPhoneDigits(national, country).slice(
      0,
      option.maxNationalDigits,
    );
    setCountry(next);
    setNational(digits);
    const nextComposed = formatInternationalPhone(digits, next);
    const nextStatus = getPhoneValidationStatus(nextComposed, next);
    onValidityChange?.(nextStatus == null || nextStatus.valid);
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <input type="hidden" name={name} value={composed} />
      <div className="flex gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-2.5 text-sm",
                "hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60",
              )}
              aria-label={`Country code ${meta.dial}`}
            >
              <span className="text-base leading-none" aria-hidden>
                {meta.flag}
              </span>
              <span className="font-medium tabular-nums">{meta.dial}</span>
              <ChevronDown className="size-3.5 text-text-muted" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[220px]">
            {PHONE_COUNTRIES.map((option) => (
              <DropdownMenuItem
                key={option.code}
                onClick={() => changeCountry(option.code)}
                className="gap-2"
              >
                <span className="text-base leading-none" aria-hidden>
                  {option.flag}
                </span>
                <span className="flex-1 truncate">{option.label}</span>
                <span className="tabular-nums text-text-muted">
                  {option.dial}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          disabled={disabled}
          placeholder={meta.placeholder}
          value={national}
          onChange={(e) => updateNational(e.target.value)}
          onBlur={() => setTouched(true)}
          className="min-w-0 flex-1"
          aria-label={`${label} number`}
        />
      </div>
      <FieldValidationHint
        show={touched && status !== null}
        valid={status?.valid ?? false}
        validMessage={status?.message ?? "Valid phone number"}
        invalidMessage={
          status?.message ?? "Enter a valid phone number"
        }
      />
    </div>
  );
}
