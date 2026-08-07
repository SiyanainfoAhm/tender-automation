/**
 * Backfill BidAssist document-derived metadata into Supabase without redownloading.
 *
 * Usage:
 *   npm run backfill:bidassist:supabase -- --date=2026-08-05
 *   npm run backfill:bidassist:supabase -- --date=2026-08-05 --bidassist-id=GEM-2026-B-7876981
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  extractBidAssistDocumentMetadata,
  mergeBidAssistMetadata,
} from "../bidassist/bidassistDocumentMetadataExtractor.js";
import type { BidassistMetadata } from "../bidassist/bidassistTypes.js";
import {
  getTenderMetadata,
  upsertBidassistMetadata,
  verifyBidassistMetadataRow,
} from "./tenderMetadataStore.js";

interface CliArgs {
  date: string;
  bidassistId: string | null;
}

interface Counters {
  found: number;
  upserted: number;
  verified: number;
  failed: number;
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
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

  const id =
    values.get("bidassist-id")?.trim() ||
    values.get("id")?.trim() ||
    null;

  return { date, bidassistId: id && id.length > 0 ? id : null };
}

function listBidassistFolders(date: string, bidassistId: string | null): string[] {
  const root = path.resolve(process.cwd(), "downloads", date, "BidAssist");
  if (!fs.existsSync(root)) {
    return [];
  }

  const folders = fs
    .readdirSync(root)
    .filter((name) => /^BA-/i.test(name))
    .map((name) => path.join(root, name))
    .filter((p) => fs.statSync(p).isDirectory());

  if (!bidassistId) {
    return folders.sort();
  }

  const needle = bidassistId.replace(/^BA-/i, "");
  return folders.filter((folder) => {
    const base = path.basename(folder);
    return (
      base.toUpperCase() === `BA-${needle}`.toUpperCase() ||
      base.toUpperCase().includes(needle.toUpperCase())
    );
  });
}

function listExtractedDocuments(tenderFolder: string): string[] {
  const docsDir = path.join(tenderFolder, "documents");
  if (!fs.existsSync(docsDir)) {
    return [];
  }
  return fs
    .readdirSync(docsDir)
    .map((name) => path.join(docsDir, name))
    .filter((p) => fs.statSync(p).isFile() && /\.(html?|pdf)$/i.test(p));
}

function readLocalListingMetadata(
  tenderFolder: string,
): Record<string, unknown> | null {
  const candidates = [
    path.join(tenderFolder, "metadata.json"),
    path.join(tenderFolder, "agenttender-metadata-sync.json"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
        string,
        unknown
      >;
      if (parsed.sourcePortal === "BidAssist" || parsed.bidassistId) {
        return parsed;
      }
    } catch {
      // continue
    }
  }

  const statePath = path.join(tenderFolder, "download-state.json");
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
        bidassistId?: string;
        folderId?: string;
        title?: string;
        tenderDetailUrl?: string | null;
        originalZipFile?: string | null;
      };
      if (state.bidassistId) {
        return {
          sourcePortal: "BidAssist",
          sourcePrefix: "BA",
          bidassistId: state.bidassistId,
          folderId: state.folderId || path.basename(tenderFolder),
          title: state.title || state.bidassistId,
          authority: "",
          description: "",
          category: "",
          sourceTenderPortal: "",
          city: "",
          state: "",
          closingDate: "",
          openingDateFilterFrom: "",
          openingDateFilterTo: null,
          tenderAmountText: "",
          tenderDetailUrl: state.tenderDetailUrl || "",
          downloadedAt: new Date().toISOString(),
          originalZipFile: state.originalZipFile || "",
          documents: [],
        };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function backfillOne(
  tenderFolder: string,
  counters: Counters,
): Promise<void> {
  const folderId = path.basename(tenderFolder);
  const docs = listExtractedDocuments(tenderFolder);

  let listing = readLocalListingMetadata(tenderFolder);
  const bidassistId =
    (typeof listing?.bidassistId === "string" && listing.bidassistId) ||
    folderId.replace(/^BA-/i, "");

  const remote = await getTenderMetadata("BIDASSIST", bidassistId);
  if (remote?.raw_metadata && typeof remote.raw_metadata === "object") {
    listing = {
      ...(remote.raw_metadata as Record<string, unknown>),
      ...(listing || {}),
    };
  }

  if (!listing) {
    console.warn(`SKIP ${folderId}: no listing/supabase metadata`);
    counters.failed += 1;
    return;
  }

  listing.bidassistId = bidassistId;
  listing.folderId =
    typeof listing.folderId === "string" ? listing.folderId : folderId;

  console.log(`BIDASSIST_DOCUMENT_EXTRACTION_START=${bidassistId}`);
  const documentMetadata = await extractBidAssistDocumentMetadata({
    tenderFolder,
    extractedDocumentPaths: docs,
    listingMetadata: listing,
  });
  console.log(
    `BIDASSIST_HTML_METADATA_EXTRACTED=${documentMetadata.extractionSources
      .filter((s) => s.fileType === "HTML")
      .reduce((n, s) => n + s.extractedFields.length, 0)}`,
  );
  console.log(
    `BIDASSIST_PDF_METADATA_EXTRACTED=${documentMetadata.extractionSources
      .filter((s) => s.fileType === "PDF")
      .reduce((n, s) => n + s.extractedFields.length, 0)}`,
  );

  const merged = mergeBidAssistMetadata({
    listingMetadata: listing,
    documentMetadata,
  }) as unknown as BidassistMetadata;

  console.log(
    `BIDASSIST_TENDER_VALUE_TEXT=${merged.tenderValueText ?? "null"}`,
  );
  console.log(
    `BIDASSIST_TENDER_VALUE_NUMERIC=${merged.tenderValue ?? "null"}`,
  );
  console.log(`BIDASSIST_EMD_TEXT=${merged.emdText ?? "null"}`);
  console.log(`BIDASSIST_EMD_NUMERIC=${merged.emdAmount ?? "null"}`);
  console.log(`BIDASSIST_METADATA_MERGED=${bidassistId}`);

  const sync = await upsertBidassistMetadata({
    metadata: merged,
    localFolderPath: tenderFolder,
    documentArchiveAvailable: Boolean(merged.originalZipFile) || docs.length > 0,
    logger: {
      info: (msg) => console.log(msg),
      error: (msg) => console.error(msg),
      warn: (msg) => console.warn(msg),
    },
  });

  if (!sync.ok) {
    console.error(`FAILED ${folderId}: ${sync.error}`);
    counters.failed += 1;
    return;
  }
  counters.upserted += 1;

  const verified = await verifyBidassistMetadataRow(bidassistId);
  if (verified.ok) {
    console.log(`SUPABASE_TENDER_VERIFIED=BA-${bidassistId}`);
    counters.verified += 1;
  } else {
    console.warn(`VERIFY_FAILED BA-${bidassistId}: ${verified.error}`);
    counters.failed += 1;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const folders = listBidassistFolders(args.date, args.bidassistId);
  const counters: Counters = {
    found: folders.length,
    upserted: 0,
    verified: 0,
    failed: 0,
  };

  console.log(
    `BACKFILL_BIDASSIST_START date=${args.date} folders=${folders.length}`,
  );

  for (const folder of folders) {
    try {
      await backfillOne(folder, counters);
    } catch (error) {
      counters.failed += 1;
      console.error(
        `FAILED ${path.basename(folder)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  console.log(
    `BACKFILL_BIDASSIST_DONE found=${counters.found} upserted=${counters.upserted} verified=${counters.verified} failed=${counters.failed}`,
  );
  if (counters.failed > 0 && counters.upserted === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
