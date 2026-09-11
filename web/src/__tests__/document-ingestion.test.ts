import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractHtmlText,
  ingestDocumentBytes,
} from "@/server/ingestion/extractFiles";
import {
  __testOnly_heuristicFromFiles,
  buildStructuredAiResult,
} from "@/server/ingestion/structuredExtract";
import {
  classifyIngestedFile,
  isOpaqueSourceFileName,
  type IngestedFile,
} from "@/server/ingestion/types";

const FIXTURE_ZIP = path.resolve(
  process.cwd(),
  "src/__tests__/fixtures/103500369.zip",
);

describe("document ingestion classify", () => {
  it("routes tender source document extensions including html", () => {
    expect(classifyIngestedFile("RFP.pdf")).toBe("pdf");
    expect(classifyIngestedFile("Annexure.docx")).toBe("docx");
    expect(classifyIngestedFile("BOQ.xlsx")).toBe("xlsx");
    expect(classifyIngestedFile("RFP.zip")).toBe("zip");
    expect(classifyIngestedFile("210636750.html")).toBe("html");
    expect(classifyIngestedFile("notes.htm")).toBe("html");
    expect(classifyIngestedFile("scan.png")).toBe("image");
  });

  it("detects opaque numeric portal filenames", () => {
    expect(isOpaqueSourceFileName("210636747.pdf")).toBe(true);
    expect(isOpaqueSourceFileName("210636750.html")).toBe(true);
    expect(isOpaqueSourceFileName("GST_Certificate.pdf")).toBe(false);
  });
});

describe("HTML extraction", () => {
  it("extracts visible text and tables from HTML bytes", () => {
    const html = Buffer.from(
      `<!doctype html><html><head><title>NIT</title><script>evil()</script><style>.x{}</style></head>
      <body><h1>Eligibility</h1><p>Bidder must submit GST registration.</p>
      <table><tr><th>Item</th><th>Req</th></tr><tr><td>EMD</td><td>Yes</td></tr></table>
      <ul><li>PAN Card</li></ul></body></html>`,
      "utf8",
    );
    const result = extractHtmlText(html);
    expect(result.error).toBeUndefined();
    expect(result.text).toMatch(/Eligibility/i);
    expect(result.text).toMatch(/GST registration/i);
    expect(result.text).toMatch(/EMD/i);
    expect(result.text).toMatch(/PAN Card/i);
    expect(result.text).not.toMatch(/evil/);
  });
});

describe("real ZIP 103500369.zip", () => {
  it("expands nested ZIP and extracts PDF + HTML child buffers", async () => {
    expect(fs.existsSync(FIXTURE_ZIP)).toBe(true);
    const bytes = fs.readFileSync(FIXTURE_ZIP);
    const files = await ingestDocumentBytes({
      fileName: "103500369.zip",
      bytes,
    });

    const byName = new Map(files.map((f) => [f.fileName, f]));
    expect(byName.has("210636747.pdf")).toBe(true);
    expect(byName.has("210636748.pdf")).toBe(true);
    expect(byName.has("210636750.html")).toBe(true);
    expect(
      files.some((f) => /AMC Seed act/i.test(f.fileName) && f.kind === "pdf"),
    ).toBe(true);

    const pdfA = byName.get("210636747.pdf")!;
    expect(pdfA.bytes.length).toBeGreaterThan(100_000);
    expect(pdfA.kind).toBe("pdf");
    expect(pdfA.parser).toBe("PDF");
    expect((pdfA.text || "").length).toBeGreaterThan(1000);

    const html = byName.get("210636750.html")!;
    expect(html.kind).toBe("html");
    expect(html.bytes.length).toBeGreaterThan(10_000);
    expect(html.parser).toBe("HTML");
    expect((html.text || "").length).toBeGreaterThan(100);
    expect(html.error).toBeFalsy();

    // Nested zip must not remain as a leaf zip entry.
    expect(files.some((f) => f.kind === "zip")).toBe(false);
  });

  it("does not invent checklist requirements from numeric filenames", async () => {
    const bytes = fs.readFileSync(FIXTURE_ZIP);
    const files = await ingestDocumentBytes({
      fileName: "103500369.zip",
      bytes,
    });

    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const heuristic = __testOnly_heuristicFromFiles(files);
      const names = heuristic.checklist.map((c) => c.requirement_name);
      expect(names).not.toContain("210636747");
      expect(names).not.toContain("210636748");
      expect(names).not.toContain("210636750");
      expect(names.some((n) => /^\d{6,}$/.test(n))).toBe(false);

      const result = await buildStructuredAiResult(files);
      const outNames = result.structured.checklist.map((c) => c.requirement_name);
      expect(outNames).not.toContain("210636747");
      expect(outNames).not.toContain("210636748");
      expect(outNames).not.toContain("210636750");
    } finally {
      if (prev == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });
});

describe("document ingestion heuristics", () => {
  it("builds checklist from corpus text, never opaque filenames", async () => {
    const files: IngestedFile[] = [
      {
        path: "210636747.pdf",
        fileName: "210636747.pdf",
        kind: "pdf",
        bytes: Buffer.from("pdf"),
        text: "Bidder shall submit GST registration and Integrity Pact and Technical Approach.",
      },
      {
        path: "210636750.html",
        fileName: "210636750.html",
        kind: "html",
        bytes: Buffer.from("<p>x</p>"),
        text: "PAN Card mandatory for all bidders.",
      },
    ];

    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await buildStructuredAiResult(files);
      expect(result.engine === "heuristic" || result.engine === "needs_ai").toBe(
        true,
      );
      const names = result.structured.checklist.map((c) => c.requirement_name);
      expect(names).not.toContain("210636747");
      expect(names).not.toContain("210636750");
      expect(
        result.structured.checklist.some((c) =>
          /GST|INTEGRITY|TECHNICAL|PAN/i.test(
            c.requirement_key + c.requirement_name,
          ),
        ),
      ).toBe(true);
    } finally {
      if (prev == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });

  it("marks NEEDS_AI_OR_OCR when no content and no OpenAI", async () => {
    const files: IngestedFile[] = [
      {
        path: "210636747.pdf",
        fileName: "210636747.pdf",
        kind: "pdf",
        bytes: Buffer.from("%PDF"),
        text: "",
        error: "empty",
      },
    ];
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await buildStructuredAiResult(files);
      expect(result.engine).toBe("needs_ai");
      expect(result.structured.analysis_status).toBe("NEEDS_AI_OR_OCR");
      expect(result.structured.checklist).toEqual([]);
    } finally {
      if (prev == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });
});
