/**
 * After agent uploads Tender_All_Documents.zip and persists documents_zip_url,
 * trigger Phase 3 Ask AI indexing on the web app (non-blocking).
 *
 * Preferred: POST /api/internal/ai-index-tender with CRON_SECRET.
 * Fallback: spawn `npx tsx web/scripts/index-ai-source.ts --tender ...` when
 * running in the monorepo and TENDERFLOW_APP_URL is unset.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabaseAdminClient, isSupabaseConfigured } from "./client.js";

const DEFAULT_COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function resolveCompanyId(): string {
  return (
    process.env.COMPANY_ID?.trim() ||
    process.env.SIYANA_COMPANY_ID?.trim() ||
    DEFAULT_COMPANY_ID
  );
}

function resolveAppBaseUrl(): string | null {
  const raw =
    process.env.TENDERFLOW_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "";
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

async function lookupTenderId(options: {
  sourcePortal: "TENDER247" | "BIDASSIST" | "MANUAL";
  sourceTenderId: string;
  runDate: string;
  sourceRegion?: "INDIAN" | "GLOBAL";
}): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseAdminClient();
  let query = client
    .from("agenttender_tenders")
    .select("id")
    .eq("source_portal", options.sourcePortal)
    .eq("source_tender_id", options.sourceTenderId)
    .eq("scraped_date", options.runDate)
    .limit(1);
  if (options.sourcePortal === "TENDER247" && options.sourceRegion) {
    query = query.eq("source_region", options.sourceRegion);
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.warn("[AIIndex] tender_lookup_failed", error.message);
    return null;
  }
  return data?.id ? String(data.id) : null;
}

async function triggerViaHttp(options: {
  tenderId: string;
  companyId: string;
}): Promise<boolean> {
  const base = resolveAppBaseUrl();
  const secret = process.env.CRON_SECRET?.trim();
  if (!base || !secret) return false;

  const url = `${base}/api/internal/ai-index-tender`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      tenderId: options.tenderId,
      companyId: options.companyId,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(
      `[AIIndex] http_trigger_failed status=${response.status} body=${text.slice(0, 200)}`,
    );
    return false;
  }

  console.info(
    `[AIIndex] http_trigger_ok tenderId=${options.tenderId}`,
  );
  return true;
}

function triggerViaLocalScript(options: {
  tenderId: string;
  companyId: string;
}): boolean {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "../..");
    const webDir = path.join(repoRoot, "web");
    const script = path.join(webDir, "scripts", "index-ai-source.ts");

    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", script, "--tender", options.companyId, options.tenderId],
      {
        cwd: webDir,
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          // Prefer web/.env via dotenv inside the script; keep session if agent set it.
        },
      },
    );
    child.unref();
    console.info(
      `[AIIndex] local_script_spawned tenderId=${options.tenderId}`,
    );
    return true;
  } catch (error) {
    console.warn(
      "[AIIndex] local_script_spawn_failed",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/**
 * Fire-and-forget: schedule Ask AI indexing for a tender that just got a docs zip.
 * Never throws to callers — artifact upload must not fail because of indexing.
 */
export async function scheduleTenderAiIndexAfterArtifactUpload(options: {
  sourcePortal: "TENDER247" | "BIDASSIST" | "MANUAL";
  sourceRegion?: "INDIAN" | "GLOBAL";
  sourceTenderId: string;
  runDate: string;
  logger?: { info: (msg: string) => void; warn?: (msg: string) => void };
}): Promise<void> {
  try {
    const tenderId = await lookupTenderId(options);
    if (!tenderId) {
      options.logger?.warn?.(
        "AI_INDEX_SKIPPED=tender_id_not_found",
      );
      return;
    }

    const companyId = resolveCompanyId();
    options.logger?.info?.(
      `AI_INDEX_SCHEDULE tenderId=${tenderId} companyId=${companyId}`,
    );

    const viaHttp = await triggerViaHttp({ tenderId, companyId });
    if (viaHttp) return;

    const viaLocal = triggerViaLocalScript({ tenderId, companyId });
    if (!viaLocal) {
      options.logger?.warn?.(
        "AI_INDEX_SKIPPED=no_http_and_no_local_spawn (set TENDERFLOW_APP_URL+CRON_SECRET or run from monorepo)",
      );
    }
  } catch (error) {
    options.logger?.warn?.(
      `AI_INDEX_SCHEDULE_FAILED=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
