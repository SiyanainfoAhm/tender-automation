import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PasswordRuleStatus } from "@/lib/validations/password-rules";

type PasswordRuleListProps = {
  rules: PasswordRuleStatus[];
  show: boolean;
};

export function PasswordRuleList({ rules, show }: PasswordRuleListProps) {
  if (!show) {
    return null;
  }

  return (
    <ul className="space-y-1 text-xs" aria-live="polite">
      {rules.map((rule) => (
        <li
          key={rule.id}
          className={cn(
            "flex items-center gap-1.5",
            rule.met ? "text-emerald-600" : "text-text-muted",
          )}
        >
          {rule.met ? (
            <Check className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <X className="size-3.5 shrink-0 text-red-500" aria-hidden />
          )}
          <span>{rule.label}</span>
        </li>
      ))}
    </ul>
  );
}

type FieldValidationHintProps = {
  show: boolean;
  valid: boolean;
  validMessage: string;
  invalidMessage: string;
};

export function FieldValidationHint({
  show,
  valid,
  validMessage,
  invalidMessage,
}: FieldValidationHintProps) {
  if (!show) {
    return null;
  }

  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs",
        valid ? "text-emerald-600" : "text-red-600",
      )}
      aria-live="polite"
    >
      {valid ? (
        <Check className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <X className="size-3.5 shrink-0" aria-hidden />
      )}
      <span>{valid ? validMessage : invalidMessage}</span>
    </p>
  );
}
