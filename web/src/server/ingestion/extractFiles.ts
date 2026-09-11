import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import ExcelJS from "exceljs";

import {
  classifyIngestedFile,
  type IngestedFile,
  type IngestedFileKind,
} from "@/server/ingestion/types";

const MAX_TEXT_CHARS_PER_FILE = 100_000;
const MAX_ZIP_ENTRIES = 80;
const MAX_ZIP_DEPTH = 3;

function logIngest(...parts: unknown[]) {
  console.info("[ingestion]", ...parts);
}

async function extractPdfText(
  bytes: Buffer,
): Promise<{ text: string; pageCount: number | null }> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const text = String(result?.text ?? "").trim();
    const pageCount =
      typeof (result as { total?: number })?.total === "number"
        ? (result as { total: number }).total
        : null;
    return { text, pageCount };
  } finally {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (parser as any).destroy?.();
    } catch {
      // ignore
    }
  }
}

async function extractDocxText(bytes: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: bytes });
  return String(result.value ?? "").trim();
}

async function extractSpreadsheetText(bytes: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(bytes as any);
  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values)
        ? row.values
            .slice(1)
            .map((v) => (v == null ? "" : String(v)))
            .join(" | ")
        : "";
      if (values.trim()) rows.push(values);
    });
    if (rows.length) {
      parts.push(`Sheet: ${sheet.name}\n${rows.slice(0, 200).join("\n")}`);
    }
  });
  return parts.join("\n\n").trim();
}

/**
 * HTML → readable text (keep headings/lists/tables; drop script/style).
 */
export function extractHtmlText(bytes: Buffer): {
  text: string;
  error?: string;
} {
  let raw = "";
  try {
    raw = bytes.toString("utf8");
    if (raw.includes("\uFFFD") || /charset\s*=\s*["']?(windows-1252|iso-8859-1)/i.test(raw)) {
      raw = bytes.toString("latin1");
    }
  } catch (error) {
    return {
      text: "",
      error: error instanceof Error ? error.message : "html-decode-failed",
    };
  }

  if (!raw.trim()) {
    return { text: "", error: "html-empty-bytes" };
  }

  let html = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const parts: string[] = [];
  if (title?.trim()) parts.push(`Title: ${decodeEntities(stripTags(title))}`);

  html = html.replace(
    /<(h[1-6]|p|li|label|td|th|caption|div|span|a|strong|em|b|i|u|br|tr|table|ul|ol)(\s[^>]*)?>/gi,
    (match, tag: string) => {
      const t = tag.toLowerCase();
      if (t === "br") return "\n";
      if (t === "tr") return "\n";
      if (t === "td" || t === "th") return " | ";
      if (t === "li") return "\n- ";
      if (/^h[1-6]$/.test(t)) return `\n\n`;
      if (t === "p" || t === "div" || t === "table" || t === "ul" || t === "ol") {
        return "\n";
      }
      return " ";
    },
  );

  const text = decodeEntities(stripTags(html))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!text) {
    return { text: "", error: "html-no-visible-text" };
  }

  const combined = parts.length ? `${parts.join("\n")}\n\n${text}` : text;
  return { text: combined };
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS_PER_FILE) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, MAX_TEXT_CHARS_PER_FILE)}\n\n[TRUNCATED]`,
    truncated: true,
  };
}

function parserForKind(kind: IngestedFileKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "docx":
      return "DOCX";
    case "doc":
      return "DOC";
    case "xlsx":
    case "xls":
      return "SPREADSHEET";
    case "csv":
      return "CSV";
    case "html":
      return "HTML";
    case "txt":
    case "xml":
      return "TEXT";
    case "image":
      return "IMAGE";
    case "zip":
      return "ZIP_RECURSIVE";
    default:
      return "UNSUPPORTED";
  }
}

export async function extractTextForKind(
  kind: IngestedFileKind,
  bytes: Buffer,
  fileName: string,
): Promise<{
  text: string;
  truncated?: boolean;
  error?: string;
  pageCount?: number | null;
  parser: string;
}> {
  const parser = parserForKind(kind);
  try {
    let text = "";
    let pageCount: number | null = null;
    if (kind === "pdf") {
      const pdf = await extractPdfText(bytes);
      text = pdf.text;
      pageCount = pdf.pageCount;
    } else if (kind === "docx") text = await extractDocxText(bytes);
    else if (kind === "xlsx" || kind === "xls") {
      text = await extractSpreadsheetText(bytes);
    } else if (kind === "csv" || kind === "txt" || kind === "xml") {
      text = bytes.toString("utf8");
    } else if (kind === "html") {
      const html = extractHtmlText(bytes);
      if (html.error && !html.text) {
        return { text: "", error: html.error, parser };
      }
      text = html.text;
    } else if (kind === "image") {
      return { text: "", error: "image-requires-vision", parser };
    } else if (kind === "doc" || kind === "ppt" || kind === "pptx") {
      return {
        text: "",
        error: `convert-or-openai-binary:${kind}`,
        parser,
      };
    } else {
      return { text: "", error: `unsupported:${kind}`, parser };
    }
    const capped = truncate(text);
    return {
      text: capped.text,
      truncated: capped.truncated,
      pageCount,
      parser,
    };
  } catch (error) {
    return {
      text: "",
      error: error instanceof Error ? error.message : String(error),
      parser,
    };
  }
}

async function expandZip(
  bytes: Buffer,
  parentPath: string,
  depth: number,
): Promise<IngestedFile[]> {
  if (depth > MAX_ZIP_DEPTH) {
    logIngest("ZIP_DEPTH_SKIP", { parentPath, depth, max: MAX_ZIP_DEPTH });
    return [];
  }
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .slice(0, MAX_ZIP_ENTRIES);
  logIngest("INGESTION ZIP", {
    path: parentPath,
    depth,
    sourceBytes: bytes.length,
    entryCount: entries.length,
  });

  const out: IngestedFile[] = [];
  for (const entry of entries) {
    const fileName = entry.name.split(/[/\\]/).pop() || entry.name;
    if (fileName.startsWith(".")) continue;
    const kind = classifyIngestedFile(fileName);
    // Actual child bytes — never filename-only metadata.
    const content = Buffer.from(await entry.async("uint8array"));
    const nestedPath = `${parentPath}/${entry.name}`.replace(/\/+/g, "/");
    const extension =
      fileName.includes(".") ? `.${fileName.split(".").pop()}` : "";

    logIngest("ENTRY", {
      path: nestedPath,
      basename: fileName,
      extension,
      kind,
      bufferLength: content.length,
      isDirectory: false,
      parserSelected: parserForKind(kind),
    });

    if (kind === "zip") {
      out.push(...(await expandZip(content, nestedPath, depth + 1)));
      continue;
    }

    const extracted = await extractTextForKind(kind, content, fileName);
    logIngest("PARSE RESULT", {
      filename: fileName,
      parser: extracted.parser,
      textLength: extracted.text.length,
      pageCount: extracted.pageCount ?? null,
      status: extracted.error ? "error" : extracted.text ? "ok" : "empty",
      error: extracted.error || null,
    });

    out.push({
      path: nestedPath,
      fileName,
      kind,
      bytes: content,
      text: extracted.text,
      truncated: extracted.truncated,
      error: extracted.error,
      pageCount: extracted.pageCount,
      parser: extracted.parser,
    });
  }
  return out;
}

/**
 * Tender Documents → Document Ingestion Service file router.
 * ZIP archives are expanded recursively; leaf files keep real byte buffers.
 */
export async function ingestDocumentBytes(options: {
  fileName: string;
  bytes: Buffer;
}): Promise<IngestedFile[]> {
  const kind = classifyIngestedFile(options.fileName);
  logIngest("INGESTION SOURCE", {
    sourceFilename: options.fileName,
    sourceBytes: options.bytes.length,
    kind,
  });

  if (kind === "zip") {
    return expandZip(options.bytes, options.fileName, 0);
  }
  const extracted = await extractTextForKind(
    kind,
    options.bytes,
    options.fileName,
  );
  logIngest("PARSE RESULT", {
    filename: options.fileName,
    parser: extracted.parser,
    textLength: extracted.text.length,
    pageCount: extracted.pageCount ?? null,
    status: extracted.error ? "error" : extracted.text ? "ok" : "empty",
    error: extracted.error || null,
  });
  return [
    {
      path: options.fileName,
      fileName: options.fileName,
      kind,
      bytes: options.bytes,
      text: extracted.text,
      truncated: extracted.truncated,
      error: extracted.error,
      pageCount: extracted.pageCount,
      parser: extracted.parser,
    },
  ];
}
