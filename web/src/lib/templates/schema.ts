import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

const optionalLongText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: "Enter a valid date",
  });

export const bidProfileTemplateSchema = z.object({
  templateName: z.string().trim().min(1, "Template name is required").max(200),
  description: optionalLongText,
  isDefault: z.boolean().optional().default(false),
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  referenceNumber: optionalText,
  tenderAcceptanceUndertakingDate: optionalDate,
  minimumLocalContent: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number.parseFloat(String(v));
      return Number.isFinite(n) ? n : Number.NaN;
    })
    .refine((v) => v == null || (v >= 0 && v <= 100), {
      message: "Minimum local content must be between 0 and 100",
    }),
  localValueAdditionLocation: optionalText,
  authorizedPersonName: z
    .string()
    .trim()
    .min(1, "Authorized person is required")
    .max(200),
  authorizedPersonPosition: optionalText,
  signatoryName: z.string().trim().min(1, "Signatory name is required").max(200),
  signatoryDesignation: optionalText,
  departmentName: z
    .string()
    .trim()
    .min(1, "Department name is required")
    .max(200),
  departmentAddress: optionalLongText,
  companyAddress: optionalLongText,
  companyLogoUrl: optionalLongText,
  companySignatoryUrl: optionalLongText,
});

export type BidProfileTemplateFormValues = z.infer<
  typeof bidProfileTemplateSchema
>;
