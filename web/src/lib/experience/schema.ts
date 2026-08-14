import { z } from "zod";

import { NATURE_OF_WORK_OPTIONS } from "@/lib/experience/nature-of-work";
import { parseInrInput } from "@/lib/format-inr";

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || z.string().email().safeParse(v).success, {
    message: "Enter a valid email address",
  });

const dateValue = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: "Enter a valid date",
  });

const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: "Enter a valid date",
  });

const indianMobile = z
  .string()
  .trim()
  .min(1, "Mobile number is required")
  .max(20)
  .refine((v) => {
    const digits = v.replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) {
      return /^[6-9]\d{9}$/.test(digits.slice(2));
    }
    if (digits.length === 11 && digits.startsWith("0")) {
      return /^[6-9]\d{9}$/.test(digits.slice(1));
    }
    return /^[6-9]\d{9}$/.test(digits);
  }, "Enter a valid 10-digit mobile number");

export const companyExperienceSchema = z
  .object({
    projectName: z
      .string()
      .trim()
      .min(1, "Project name is required")
      .max(200),
    clientName: z
      .string()
      .trim()
      .min(1, "Client / Organization is required")
      .max(200),
    location: z.string().trim().min(1, "Location is required").max(200),
    natureOfWork: z.enum(NATURE_OF_WORK_OPTIONS, {
      message: "Select nature of work",
    }),
    contractValue: z
      .string()
      .trim()
      .min(1, "Contract value is required")
      .transform((v, ctx) => {
        const amount = parseInrInput(v);
        if (amount == null || amount <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Enter a valid contract value in INR, Cr, or L",
          });
          return z.NEVER;
        }
        return amount;
      }),
    projectStatus: z.enum(["ongoing", "completed"]),
    startDate: dateValue,
    completionDate: optionalDate,
    expectedCompletionDate: optionalDate,
    description: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
    contactPersonName: z
      .string()
      .trim()
      .min(1, "Contact person name is required")
      .max(200),
    contactMobile: indianMobile,
    contactEmail: optionalEmail,
  })
  .superRefine((value, ctx) => {
    if (value.projectStatus === "completed") {
      if (!value.completionDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Completion date is required",
          path: ["completionDate"],
        });
      } else if (value.completionDate < value.startDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Completion date cannot be before the start date",
          path: ["completionDate"],
        });
      }
    } else if (
      value.expectedCompletionDate &&
      value.expectedCompletionDate < value.startDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected completion cannot be before the start date",
        path: ["expectedCompletionDate"],
      });
    }
  });

export type CompanyExperienceFormValues = z.infer<
  typeof companyExperienceSchema
>;
