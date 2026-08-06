/**
 * Structured verification of Tender247 / BidAssist E2E Supabase rows.
 */
import "dotenv/config";
import {
  getTenderMetadata,
  type SourcePortal,
} from "./tenderMetadataStore.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "./client.js";

const ALLOWED_QUAL = new Set([
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
  "VERIFY",
  "NO_GO",
]);

export type EndToEndVerificationResult = {
  ok: boolean;
  metadataVerified: boolean;
  qualificationVerified: boolean;
  statusSyncVerified: boolean;
  documentsEnriched: boolean;
  qualificationStatus:
    | "GO"
    | "CONDITIONAL_GO"
    | "PARTNER_BID"
    | "VERIFY"
    | "NO_GO"
    | null;
  chatUrl: string | null;
  error: string | null;
};

function parseArgs(argv: string[]): {
  source: SourcePortal;
  id: string;
} {
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
    if (next && !next.startsWith("--")) {
      values.set(body, next);
      i += 1;
    }
  }

  const sourceRaw = (values.get("source") || "").trim().toLowerCase();
  let source: SourcePortal;
  if (sourceRaw === "tender247") source = "TENDER247";
  else if (sourceRaw === "bidassist") source = "BIDASSIST";
  else {
    throw new Error("--source=tender247|bidassist is required");
  }

  const id = (values.get("id") || "").trim();
  if (!id) {
    throw new Error("--id=<source tender ID> is required");
  }
  return { source, id };
}

function hasBidassistEnrichment(raw: Record<string, unknown>): boolean {
  const extraction = raw.documentExtraction;
  const normalized = raw.normalized;
  return (
    (extraction != null && typeof extraction === "object") ||
    (normalized != null && typeof normalized === "object")
  );
}

/** Verify metadata + qualification rows for one source tender. */
export async function verifySourceEndToEndRows(options: {
  source: SourcePortal;
  sourceTenderId: string;
}): Promise<EndToEndVerificationResult> {
  const { source, sourceTenderId } = options;
  const empty: EndToEndVerificationResult = {
    ok: false,
    metadataVerified: false,
    qualificationVerified: false,
    statusSyncVerified: false,
    documentsEnriched: source === "TENDER247",
    qualificationStatus: null,
    chatUrl: null,
    error: null,
  };

  if (!isSupabaseConfigured()) {
    return { ...empty, error: "Supabase is not configured" };
  }

  const meta = await getTenderMetadata(source, sourceTenderId);
  if (!meta) {
    return { ...empty, error: `Metadata row missing for ${source}/${sourceTenderId}` };
  }
  if (
    !meta.raw_metadata ||
    typeof meta.raw_metadata !== "object" ||
    Array.isArray(meta.raw_metadata) ||
    Object.keys(meta.raw_metadata).length === 0
  ) {
    return { ...empty, error: "raw_metadata is not populated" };
  }
  if (!meta.download_status) {
    return { ...empty, error: "download_status is missing" };
  }

  const raw = meta.raw_metadata as Record<string, unknown>;
  const documentsEnriched =
    source === "BIDASSIST" ? hasBidassistEnrichment(raw) : true;

  console.log("SUPABASE_E2E_METADATA_VERIFIED");

  const client = getSupabaseAdminClient();
  const { data: qual, error } = await client
    .from("agenttender_qualification_results")
    .select("status, raw_response, raw_result, chat_url")
    .eq("source_portal", source)
    .eq("source_tender_id", sourceTenderId)
    .maybeSingle();

  if (error) {
    return {
      ...empty,
      metadataVerified: true,
      documentsEnriched,
      error: error.message,
    };
  }
  if (!qual) {
    return {
      ...empty,
      metadataVerified: true,
      documentsEnriched,
      error: "Qualification row missing",
    };
  }
  if (!ALLOWED_QUAL.has(String(qual.status))) {
    return {
      ...empty,
      metadataVerified: true,
      documentsEnriched,
      error: `Invalid qualification status: ${qual.status}`,
    };
  }
  if (
    typeof qual.raw_response !== "string" ||
    qual.raw_response.trim().length === 0
  ) {
    return {
      ...empty,
      metadataVerified: true,
      documentsEnriched,
      error: "raw_response is empty",
    };
  }
  if (
    !qual.raw_result ||
    typeof qual.raw_result !== "object" ||
    Array.isArray(qual.raw_result)
  ) {
    return {
      ...empty,
      metadataVerified: true,
      documentsEnriched,
      error: "raw_result is not populated",
    };
  }

  const chatUrl =
    typeof qual.chat_url === "string" && /\/c\/[^/?#]+/i.test(qual.chat_url)
      ? qual.chat_url
      : null;
  if (!chatUrl) {
    return {
      ...empty,
      metadataVerified: true,
      documentsEnriched,
      error: "chat_url missing or does not contain /c/",
    };
  }

  console.log("SUPABASE_E2E_QUALIFICATION_VERIFIED");

  const statusSyncVerified = meta.qualification_status === qual.status;
  if (!statusSyncVerified) {
    return {
      ok: false,
      metadataVerified: true,
      qualificationVerified: true,
      statusSyncVerified: false,
      documentsEnriched,
      qualificationStatus: qual.status as EndToEndVerificationResult["qualificationStatus"],
      chatUrl,
      error: `qualification_status sync mismatch: tender=${meta.qualification_status} qual=${qual.status}`,
    };
  }
  console.log("SUPABASE_E2E_STATUS_SYNC_VERIFIED");

  return {
    ok: true,
    metadataVerified: true,
    qualificationVerified: true,
    statusSyncVerified: true,
    documentsEnriched,
    qualificationStatus: qual.status as EndToEndVerificationResult["qualificationStatus"],
    chatUrl,
    error: null,
  };
}

async function main(): Promise<void> {
  const { source, id } = parseArgs(process.argv.slice(2));
  const result = await verifySourceEndToEndRows({
    source,
    sourceTenderId: id,
  });
  if (!result.ok) {
    throw new Error(result.error || "Verification failed");
  }
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("verifyEndToEndRows.ts") ||
    process.argv[1].endsWith("verifyEndToEndRows.js"));

if (isDirect) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
