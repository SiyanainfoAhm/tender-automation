"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PROJECT_CATEGORIES } from "@/lib/project-category";
import { TENDER_STATUSES } from "@/lib/tender-status";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { CompanyAccessError } from "@/server/auth/company-access";
import { createManualTender } from "@/server/repositories/tenderRepository";

const contactSchema = z.object({
  name: z.string().trim().min(1, "Contact name is required").max(120),
  mobile: z
    .string()
    .trim()
    .min(8, "Mobile number is required")
    .max(20)
    .regex(/^[+\d][\d\s()-]{7,}$/, "Enter a valid mobile number"),
  email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

const createManualTenderSchema = z
  .object({
    title: z.string().trim().min(1, "Tender name is required").max(500),
    referenceNo: z.string().trim().min(1, "Reference no is required").max(120),
    portal: z.enum(["MANUAL", "TENDER247", "BIDASSIST"]),
    portalLink: z
      .string()
      .trim()
      .url("Enter a valid URL")
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
    category: z.enum(PROJECT_CATEGORIES),
    tenderType: z.string().trim().max(120).optional().nullable(),
    organization: z.string().trim().min(1, "Organization is required").max(240),
    department: z.string().trim().max(240).optional().nullable(),
    location: z.string().trim().min(1, "Location is required").max(240),
    initialStatus: z
      .enum(TENDER_STATUSES)
      .optional()
      .nullable()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
    creationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Creation date is required"),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Deadline is required"),
    estimatedValue: z.coerce.number().min(0, "Estimated value must be ≥ 0"),
    tenderEstCost: z.coerce.number().min(0).optional().nullable(),
    emd: z.coerce.number().min(0).optional().nullable(),
    tenderFee: z.coerce.number().min(0).optional().nullable(),
    processingFee: z.coerce.number().min(0).optional().nullable(),
    finalCost: z.coerce.number().min(0).optional().nullable(),
    msmeExemption: z.boolean().optional().default(false),
    startupExemption: z.boolean().optional().default(false),
    exemptionTypes: z.array(z.enum(["Turnover", "Experience", "EMD"])).optional(),
    contacts: z.array(contactSchema).min(1, "At least one contact is required"),
    description: z.string().trim().min(1, "Description is required").max(8000),
    notes: z.string().trim().max(4000).optional().nullable(),
    noBidReason: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.deadline < data.creationDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Deadline must be on or after creation date",
        path: ["deadline"],
      });
    }
    if (data.initialStatus === "NO_GO" && !(data.noBidReason || "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "No Bid reason is required when status is No Bid",
        path: ["noBidReason"],
      });
    }
  });

export type CreateManualTenderResult =
  | { ok: true; id: string; sourceTenderId: string; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createManualTenderAction(
  input: unknown,
): Promise<CreateManualTenderResult> {
  try {
    await requirePermissionStrict("tenders.edit");

    const parsed = createManualTenderSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_form";
        if (!fieldErrors[key]) fieldErrors[key] = [];
        fieldErrors[key].push(issue.message);
      }
      return {
        ok: false,
        error: "Please fix the highlighted fields.",
        fieldErrors,
      };
    }

    const created = await createManualTender({
      ...parsed.data,
      tenderType: parsed.data.tenderType || null,
      department: parsed.data.department || null,
      notes: parsed.data.notes || null,
      noBidReason: parsed.data.noBidReason || null,
      tenderEstCost: parsed.data.tenderEstCost ?? null,
      emd: parsed.data.emd ?? null,
      tenderFee: parsed.data.tenderFee ?? null,
      processingFee: parsed.data.processingFee ?? null,
      finalCost: parsed.data.finalCost ?? null,
    });

    revalidatePath("/tenders", "layout");
    revalidatePath(`/tenders/${created.id}`);

    return {
      ok: true,
      id: created.id,
      sourceTenderId: created.sourceTenderId,
      message: "Manual tender created successfully.",
    };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unable to create tender.",
    };
  }
}
