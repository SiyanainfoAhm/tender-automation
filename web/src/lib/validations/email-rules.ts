import { z } from "zod";

const emailSchema = z.string().email();

export type EmailValidationStatus = {
  valid: boolean;
  message: string;
};

export function getEmailValidationStatus(value: string): EmailValidationStatus | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const valid = emailSchema.safeParse(trimmed).success;
  return {
    valid,
    message: valid ? "Valid email format" : "Enter a valid email address",
  };
}
