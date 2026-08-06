import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { CompleteTenderMetadata } from "../tender247Batch/extractCompleteMetadata.js";
import {
  upsertTender247Metadata,
  verifyTender247MetadataRow,
} from "./tenderMetadataStore.js";

interface CliArgs {
  date: string;
  t247Id: string | null;
  deleteLocalMetadata: boolean;
}

interface BackfillCounters {
  found: number;
  upserted: number;
  verified: number;
  deleted: number;
  failed: number;
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) {
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      values.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(body, next);
      i += 1;
    } else {
      values.set(body, "true");
    }
  }

  const date = values.get("date")?.trim();
  if (!date) {
    throw new Error("--date is required (YYYY-MM-DD)");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid --date=${date}; expected YYYY-MM-DD`);
  }

  const t247IdRaw = values.get("t247-id")?.trim() ?? null;
  if (t247IdRaw !== null && t247IdRaw !== "" && !/^\d+$/.test(t247IdRaw)) {
    throw new Error(`Invalid --t247-id=${t247IdRaw}; digits only`);
  }

  const deleteRaw = values.get("delete-local-metadata");
  let deleteLocalMetadata = false;
  if (deleteRaw !== undefined) {
    const normalized = deleteRaw.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      deleteLocalMetadata = true;
    } else if (normalized === "false" || normalized === "0") {
      deleteLocalMetadata = false;
    } else {
      throw new Error(
        `Invalid --delete-local-metadata=${deleteRaw}; expected true or false`,
      );
    }
  }

  return {
    date,
    t247Id: t247IdRaw && t247IdRaw.length > 0 ? t247IdRaw : null,
    deleteLocalMetadata,
  };
}

function isNonEmptyFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function findMetadataFiles(date: string, t247Id: string | null): string[] {
  const dateRoot = path.resolve(process.cwd(), "downloads", date);

  if (t247Id) {
    const metadataPath = path.resolve(
      dateRoot,
      `T247-${t247Id}`,
      "metadata.json",
    );
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`TENDER247_METADATA_FILE_NOT_FOUND=T247-${t247Id}`);
    }
    return [metadataPath];
  }

  if (!fs.existsSync(dateRoot)) {
    return [];
  }

  const entries = fs.readdirSync(dateRoot, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^T247-\d+$/.test(entry.name)) {
      continue;
    }
    const metadataPath = path.resolve(dateRoot, entry.name, "metadata.json");
    if (fs.existsSync(metadataPath) && fs.statSync(metadataPath).isFile()) {
      files.push(metadataPath);
    }
  }
  files.sort();
  return files;
}

function deriveT247IdFromFolder(metadataPath: string): string {
  const folderName = path.basename(path.dirname(metadataPath));
  const match = folderName.match(/^T247-(\d+)$/);
  if (!match) {
    throw new Error(`Invalid tender folder name: ${folderName}`);
  }
  return match[1]!;
}

function readAndValidateMetadata(
  metadataPath: string,
  expectedT247Id: string,
): CompleteTenderMetadata {
  const text = fs.readFileSync(metadataPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${metadataPath}: ${message}`);
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      `Metadata must be a non-null object: ${metadataPath}`,
    );
  }

  const record = parsed as Record<string, unknown>;
  const metadata = {
    ...record,
    t247Id: expectedT247Id,
  } as CompleteTenderMetadata;

  return metadata;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const metadataFiles = findMetadataFiles(args.date, args.t247Id);

  const counters: BackfillCounters = {
    found: metadataFiles.length,
    upserted: 0,
    verified: 0,
    deleted: 0,
    failed: 0,
  };

  for (const metadataPath of metadataFiles) {
    const t247Id = deriveT247IdFromFolder(metadataPath);
    const folderId = `T247-${t247Id}`;

    try {
      const metadata = readAndValidateMetadata(metadataPath, t247Id);
      const tenderFolder = path.dirname(metadataPath);
      const aiSummaryAvailable = isNonEmptyFile(
        path.join(tenderFolder, "AI_Summary.pdf"),
      );
      const documentArchiveAvailable = isNonEmptyFile(
        path.join(tenderFolder, "documents", "Tender_All_Documents.zip"),
      );

      console.log(`SUPABASE_TENDER_UPSERT_START=${folderId}`);

      const upsert = await upsertTender247Metadata({
        metadata,
        localFolderPath: tenderFolder,
        aiSummaryAvailable,
        documentArchiveAvailable,
      });

      if (!upsert.ok) {
        throw new Error(upsert.error || "Upsert failed");
      }

      console.log(`SUPABASE_TENDER_UPSERTED=${folderId}`);
      console.log(`SUPABASE_TENDER_DATABASE_ID=${upsert.id ?? ""}`);
      counters.upserted += 1;

      const verified = await verifyTender247MetadataRow(t247Id);
      if (!verified.ok || !verified.row) {
        throw new Error(verified.error || "Verification failed");
      }
      if (verified.row.source_tender_id !== t247Id) {
        throw new Error(
          `Verified source_tender_id mismatch: ${verified.row.source_tender_id} != ${t247Id}`,
        );
      }
      const raw = verified.row.raw_metadata;
      if (
        raw === null ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        Object.keys(raw).length === 0
      ) {
        throw new Error("Verified raw_metadata is empty");
      }

      console.log(`SUPABASE_TENDER_VERIFIED=${folderId}`);
      counters.verified += 1;

      if (args.deleteLocalMetadata) {
        fs.rmSync(metadataPath, { force: true });
        console.log(`LOCAL_METADATA_DELETED=${folderId}`);
        counters.deleted += 1;
      }
    } catch (error) {
      counters.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      if (args.t247Id) {
        console.error(message);
        printSummary(args.date, counters);
        process.exit(1);
      }
      console.error(`SUPABASE_TENDER_BACKFILL_FAILED=${folderId} ${message}`);
    }
  }

  printSummary(args.date, counters);
  if (counters.failed > 0) {
    process.exit(1);
  }
}

function printSummary(date: string, counters: BackfillCounters): void {
  console.log("==================================");
  console.log("Tender247 Supabase Backfill");
  console.log(`Date: ${date}`);
  console.log(`Metadata files found: ${counters.found}`);
  console.log(`Upserted: ${counters.upserted}`);
  console.log(`Verified: ${counters.verified}`);
  console.log(`Deleted locally: ${counters.deleted}`);
  console.log(`Failed: ${counters.failed}`);
  console.log("==================================");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
