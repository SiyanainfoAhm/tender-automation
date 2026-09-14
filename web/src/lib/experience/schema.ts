import { z } from "zod";

import { NATURE_OF_WORK_OPTIONS } from "@/lib/experience/nature-of-work";
import { PROJECT_TYPE_OPTIONS } from "@/lib/experience/project-type";
import { parseInrInput } from "@/lib/format-inr";
import { isValidIndianMobile } from "@/lib/validations/phone-rules";

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
  .refine(
    (v) => isValidIndianMobile(v),
    "Enter a valid 10-digit mobile number",
  );

const natureOfWorkValue = z.preprocess((raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  return [];
}, z
  .array(z.enum(NATURE_OF_WORK_OPTIONS))
  .min(1, "Select at least one nature of work"));

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
    projectType: z.enum(PROJECT_TYPE_OPTIONS, {
      message: "Select project type",
    }),
    natureOfWork: natureOfWorkValue,
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
    }
  });

export type CompanyExperienceFormValues = z.infer<
  typeof companyExperienceSchema
>;
