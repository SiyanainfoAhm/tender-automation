import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import type { GeneratedDocumentContent } from "@/server/generation/types";

function paragraph(text: string, opts?: { bold?: boolean }) {
  return new Paragraph({
    spacing: { after: 160 },
    children: [
      new TextRun({
        text,
        bold: opts?.bold,
        size: 22,
        font: "Calibri",
      }),
    ],
  });
}

function bullet(text: string) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 22, font: "Calibri" })],
  });
}

/**
 * Render structured generation output into a real OOXML DOCX buffer.
 */
export async function renderGeneratedDocx(options: {
  content: GeneratedDocumentContent;
  tenderTitle: string;
  tenderReference: string;
  companyName: string;
  requirementName: string;
}): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: options.content.document_title || options.requirementName,
          bold: true,
          size: 36,
          font: "Calibri",
        }),
      ],
    }),
  );
  children.push(
    paragraph(`Tender: ${options.tenderTitle}`),
    paragraph(`Reference: ${options.tenderReference}`),
    paragraph(`Bidder: ${options.companyName}`),
    paragraph("Status: DRAFT — AI generated for review", { bold: true }),
  );

  for (const section of options.content.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
        children: [
          new TextRun({
            text: section.heading,
            bold: true,
            size: 26,
            font: "Calibri",
          }),
        ],
      }),
    );
    for (const block of section.content) {
      if (block.type === "paragraph") {
        children.push(paragraph(block.text));
      } else if (block.type === "bullets") {
        for (const item of block.items) children.push(bullet(item));
      } else if (block.type === "numbered") {
        block.items.forEach((item, index) => {
          children.push(
            new Paragraph({
              spacing: { after: 80 },
              children: [
                new TextRun({
                  text: `${index + 1}. ${item}`,
                  size: 22,
                  font: "Calibri",
                }),
              ],
            }),
          );
        });
      }
    }
  }

  for (const table of options.content.tables) {
    if (table.title) {
      children.push(
        new Paragraph({
          spacing: { before: 240, after: 120 },
          children: [
            new TextRun({
              text: table.title,
              bold: true,
              size: 22,
              font: "Calibri",
            }),
          ],
        }),
      );
    }
    const headers = table.headers.length
      ? table.headers
      : table.rows[0]?.map((_, i) => `Column ${i + 1}`) || ["Column"];
    const colCount = Math.max(headers.length, 1);
    const width = Math.floor(9000 / colCount);
    const border = {
      style: BorderStyle.SINGLE,
      size: 4,
      color: "999999",
    };
    children.push(
      new Table({
        width: { size: 9000, type: WidthType.DXA },
        rows: [
          new TableRow({
            children: headers.map(
              (h) =>
                new TableCell({
                  width: { size: width, type: WidthType.DXA },
                  borders: {
                    top: border,
                    bottom: border,
                    left: border,
                    right: border,
                  },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: h,
                          bold: true,
                          size: 18,
                          font: "Calibri",
                        }),
                      ],
                    }),
                  ],
                }),
            ),
          }),
          ...table.rows.map(
            (row) =>
              new TableRow({
                children: Array.from({ length: colCount }).map((_, idx) => {
                  return new TableCell({
                    width: { size: width, type: WidthType.DXA },
                    borders: {
                      top: border,
                      bottom: border,
                      left: border,
                      right: border,
                    },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: row[idx] ?? "",
                            size: 18,
                            font: "Calibri",
                          }),
                        ],
                      }),
                    ],
                  });
                }),
              }),
          ),
        ],
      }),
    );
  }

  if (options.content.missing_information.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
        children: [
          new TextRun({
            text: "Missing Information (Company Input Required)",
            bold: true,
            size: 26,
            font: "Calibri",
          }),
        ],
      }),
    );
    for (const item of options.content.missing_information) {
      children.push(bullet(item));
    }
  }

  if (options.content.warnings.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
        children: [
          new TextRun({
            text: "Warnings",
            bold: true,
            size: 26,
            font: "Calibri",
          }),
        ],
      }),
    );
    for (const item of options.content.warnings) {
      children.push(bullet(item));
    }
  }

  const doc = new Document({
    creator: "TenderFlow",
    title: options.content.document_title || options.requirementName,
    description: `AI draft for ${options.tenderReference}`,
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${options.companyName} · ${options.tenderReference}`,
                    italics: true,
                    size: 16,
                    font: "Calibri",
                    color: "666666",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "DRAFT · Page ",
                    size: 16,
                    font: "Calibri",
                    color: "666666",
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    font: "Calibri",
                    color: "666666",
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
