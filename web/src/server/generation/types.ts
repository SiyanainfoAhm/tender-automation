import { z } from "zod";

export const GENERATION_PROMPT_VERSION = "checklist-doc-v1";

export const generatedContentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("paragraph"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("bullets"),
    items: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal("numbered"),
    items: z.array(z.string()).default([]),
  }),
]);

export const generatedSectionSchema = z.object({
  heading: z.string().min(1),
  content: z.array(generatedContentBlockSchema).default([]),
});

export const generatedTableSchema = z.object({
  title: z.string().optional().nullable(),
  headers: z.array(z.string()).default([]),
  rows: z.array(z.array(z.string())).default([]),
});

export const generatedDocumentSchema = z.object({
  document_title: z.string().min(1),
  document_type: z.string().min(1),
  sections: z.array(generatedSectionSchema).default([]),
  tables: z.array(generatedTableSchema).default([]),
  missing_information: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type GeneratedDocumentContent = z.infer<typeof generatedDocumentSchema>;

export type GenerateChecklistDocumentResult = {
  documentId: string;
  fileName: string;
  title: string;
  versionLabel: string;
  documentType: string;
  fileSizeBytes: number;
  status: "drafting";
  generationPolicy: string;
  model: string;
  missingInformation: string[];
  warnings: string[];
};
