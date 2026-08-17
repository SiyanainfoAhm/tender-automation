import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../fileUtils.js";

function pdfEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/[^\t\n\x20-\x7E]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return code > 255 ? "?" : String.fromCharCode(code);
    });
}

function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];
  const out: string[] = [];
  let remaining = line;
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf(" ", maxChars);
    if (cut < maxChars / 2) cut = maxChars;
    out.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) out.push(remaining);
  return out;
}

/**
 * Minimal PDF writer for DOM-extracted AI Summary text.
 * Used only when Tender247 has no native AI Summary download.
 */
export function writeTextPdf(filePath: string, title: string, body: string): void {
  ensureDir(path.dirname(filePath));
  const maxChars = 92;
  const linesPerPage = 58;
  const rawLines = `${title}\n\n${body}`.replace(/\r\n/g, "\n").split("\n");
  const wrapped: string[] = [];
  for (const line of rawLines) {
    if (!line.trim()) {
      wrapped.push("");
      continue;
    }
    wrapped.push(...wrapLine(line, maxChars));
  }
  if (wrapped.length === 0) wrapped.push("(empty)");

  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length; i += linesPerPage) {
    pages.push(wrapped.slice(i, i + linesPerPage));
  }

  const objects: string[] = [];
  const kids: string[] = [];
  let nextId = 3;
  const fontId = 2;
  objects[1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (const pageLines of pages) {
    const contentId = nextId++;
    const pageId = nextId++;
    const textOps = pageLines
      .map((line, idx) => {
        const y = 800 - idx * 12;
        return `1 0 0 1 48 ${y} Tm (${pdfEscape(line)}) Tj`;
      })
      .join("\n");
    const stream = `BT\n/F1 10 Tf\n${textOps}\nET`;
    objects[contentId - 1] =
      `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
    objects[pageId - 1] =
      `<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    kids.push(`${pageId} 0 R`);
  }

  objects[0] =
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  const catalogId = nextId++;
  objects[catalogId - 1] = `<< /Type /Catalog /Pages 1 0 R >>`;

  let offset = 0;
  const offsets: number[] = [0];
  const chunks: string[] = ["%PDF-1.4\n"];
  offset = Buffer.byteLength(chunks[0]!, "utf8");

  for (let i = 0; i < objects.length; i += 1) {
    const bodyObj = objects[i];
    if (!bodyObj) {
      offsets.push(offset);
      const stub = `${i + 1} 0 obj\n<< >>\nendobj\n`;
      chunks.push(stub);
      offset += Buffer.byteLength(stub, "utf8");
      continue;
    }
    offsets.push(offset);
    const obj = `${i + 1} 0 obj\n${bodyObj}\nendobj\n`;
    chunks.push(obj);
    offset += Buffer.byteLength(obj, "utf8");
  }

  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(xref, trailer);
  fs.writeFileSync(filePath, chunks.join(""), "utf8");
}

export function isPdfMagic(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    return buf.toString("utf8") === "%PDF-";
  } catch {
    return false;
  }
}
