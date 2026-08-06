export type PasswordRule = {
  id: string;
  label: string;
  test: (value: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: "At least 8 characters",
    test: (value) => value.length >= 8,
  },
  {
    id: "upper",
    label: "One uppercase letter",
    test: (value) => /[A-Z]/.test(value),
  },
  {
    id: "lower",
    label: "One lowercase letter",
    test: (value) => /[a-z]/.test(value),
  },
  {
    id: "number",
    label: "One number",
    test: (value) => /[0-9]/.test(value),
  },
  {
    id: "special",
    label: "One special character",
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
];

export type PasswordRuleStatus = PasswordRule & { met: boolean };

export function getPasswordRuleStatuses(value: string): PasswordRuleStatus[] {
  return PASSWORD_RULES.map((rule) => ({
    ...rule,
    met: rule.test(value),
  }));
}

export function isPasswordPolicyMet(value: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(value));
}
