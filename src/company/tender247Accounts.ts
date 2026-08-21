/**
 * Active Tender247 account context for a pipeline run.
 * Company preferences stay company-scoped; only credentials/session/excel are account-scoped.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "../fileUtils.js";
import { SIYANA_COMPANY_ID, resolveRunCompanyId } from "./siyanaCompany.js";
import { decryptSecret } from "./credentialCrypto.js";

export type Tender247AccountRecord = {
  id: string;
  companyId: string;
  portal: "TENDER247";
  label: string;
  username: string;
  /** Decrypted password — never log. */
  password: string;
  sessionStoragePath: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type Tender247RunAccountContext = {
  companyId: string;
  companyLabel: string;
  accountId: string;
  accountLabel: string;
  accountShort: string;
  username: string;
  password: string;
  /** Absolute path to Playwright storageState JSON */
  storageStatePath: string;
  /** Absolute path to optional persistent profile dir */
  profileDir: string;
  /** Relative seed-excel subfolder under date download root */
  seedExcelSubdir: string;
  logPrefix: string;
};

const store = new AsyncLocalStorage<Tender247RunAccountContext>();

export function getActiveTender247AccountContext(): Tender247RunAccountContext | null {
  return store.getStore() ?? null;
}

export function withTender247AccountContext<T>(
  context: Tender247RunAccountContext,
  fn: () => T,
): T {
  return store.run(context, fn);
}

export async function withTender247AccountContextAsync<T>(
  context: Tender247RunAccountContext,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(context, fn);
}

export function resolveTender247AccountAuthPaths(options: {
  companyId: string;
  accountId: string;
}): { storageStatePath: string; profileDir: string; accountRoot: string } {
  const accountRoot = resolveProjectPath(
    path.join(
      "auth",
      "tender247",
      `company-${options.companyId}`,
      `account-${options.accountId}`,
    ),
  );
  return {
    accountRoot,
    profileDir: path.join(accountRoot, "profile"),
    storageStatePath: path.join(accountRoot, "storage-state.json"),
  };
}

export function buildAccountLogPrefix(options: {
  companyLabel?: string;
  accountShort: string;
}): string {
  const company = (options.companyLabel || "SIYANA").toUpperCase().replace(/\s+/g, "_");
  return `[${company}][T247_ACCOUNT=${options.accountShort}]`;
}

function shortAccountId(accountId: string): string {
  return accountId.replace(/-/g, "").slice(0, 8);
}

/** Simple env slots for one company (Siyana) — no DB required. */
export type EnvTender247AccountSlot = "1" | "2";

export function normalizeEnvTender247AccountSlot(
  raw: string | null | undefined,
): EnvTender247AccountSlot | null {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (v === "1" || v === "main" || v === "account-1" || v === "account1") {
    return "1";
  }
  if (v === "2" || v === "backup" || v === "account-2" || v === "account2") {
    return "2";
  }
  return null;
}

function readEnvAccountSlot(slot: EnvTender247AccountSlot): {
  email: string;
  password: string;
  label: string;
} {
  const emailKey = `TENDER247_ACCOUNT_${slot}_EMAIL`;
  const passwordKey = `TENDER247_ACCOUNT_${slot}_PASSWORD`;
  const labelKey = `TENDER247_ACCOUNT_${slot}_LABEL`;
  let email = process.env[emailKey]?.trim() || "";
  let password = process.env[passwordKey]?.trim() || "";
  // Account 1 also accepts the classic single-login env vars.
  if (slot === "1") {
    if (!email) email = process.env.TENDER247_EMAIL?.trim() || "";
    if (!password) password = process.env.TENDER247_PASSWORD?.trim() || "";
  }
  const defaultLabel = slot === "1" ? "Main Account" : "Backup Account";
  const label = process.env[labelKey]?.trim() || defaultLabel;
  return { email, password, label };
}

/** Env slots that have both email + password configured (order: 1 then 2). */
export function listConfiguredEnvTender247AccountSlots(
  env: NodeJS.ProcessEnv = process.env,
): EnvTender247AccountSlot[] {
  const slots: EnvTender247AccountSlot[] = [];
  for (const slot of ["1", "2"] as const) {
    const emailKey = `TENDER247_ACCOUNT_${slot}_EMAIL`;
    const passwordKey = `TENDER247_ACCOUNT_${slot}_PASSWORD`;
    let email = env[emailKey]?.trim() || "";
    let password = env[passwordKey]?.trim() || "";
    if (slot === "1") {
      if (!email) email = env.TENDER247_EMAIL?.trim() || "";
      if (!password) password = env.TENDER247_PASSWORD?.trim() || "";
    }
    if (email && password) slots.push(slot);
  }
  return slots;
}

function contextFromEnvSlot(options: {
  companyId: string;
  slot: EnvTender247AccountSlot;
}): Tender247RunAccountContext {
  const creds = readEnvAccountSlot(options.slot);
  const accountId = `env-${options.slot}`;
  const paths = resolveTender247AccountAuthPaths({
    companyId: options.companyId,
    accountId,
  });

  // Slot 1 may reuse historical shared auth file until first account-scoped save.
  let storageStatePath = paths.storageStatePath;
  if (options.slot === "1" && !fs.existsSync(storageStatePath)) {
    const legacyPrimary = resolveProjectPath(path.join("auth", "tender247.json"));
    const legacySession = resolveProjectPath(
      path.join("auth", "tender247-session.json"),
    );
    if (fs.existsSync(legacyPrimary)) storageStatePath = legacyPrimary;
    else if (fs.existsSync(legacySession)) storageStatePath = legacySession;
  }

  return {
    companyId: options.companyId,
    companyLabel: "SIYANA",
    accountId,
    accountLabel: creds.label,
    accountShort: options.slot,
    username: creds.email,
    password: creds.password,
    storageStatePath,
    profileDir: paths.profileDir,
    seedExcelSubdir: path.join("accounts", accountId),
    logPrefix: buildAccountLogPrefix({
      companyLabel: "SIYANA",
      accountShort: options.slot,
    }),
  };
}

/**
 * Resolve account for a pipeline run.
 * Priority:
 * 1. DB UUID via --account-id / TENDER247_ACCOUNT_ID
 * 2. Env slot via --account-id=1|2 / TENDER247_ACCOUNT=1|2
 * 3. Env slot 1 / classic TENDER247_EMAIL + TENDER247_PASSWORD
 */
export async function resolveTender247RunAccount(options?: {
  companyId?: string | null;
  accountId?: string | null;
}): Promise<Tender247RunAccountContext> {
  const companyId = options?.companyId?.trim() || resolveRunCompanyId();
  const accountId =
    options?.accountId?.trim() ||
    process.env.TENDER247_ACCOUNT_ID?.trim() ||
    process.env.TENDER247_ACCOUNT?.trim() ||
    "";

  const envSlot = normalizeEnvTender247AccountSlot(accountId);
  if (envSlot) {
    return contextFromEnvSlot({ companyId, slot: envSlot });
  }

  if (accountId) {
    const record = await loadTender247AccountById({ companyId, accountId });
    if (!record) {
      throw new Error(
        `Tender247 account not found: accountId=${accountId} companyId=${companyId}`,
      );
    }
    return contextFromRecord(record);
  }

  // Default: env account 1 (or classic TENDER247_EMAIL / PASSWORD).
  return contextFromEnvSlot({ companyId, slot: "1" });
}

function contextFromRecord(
  record: Tender247AccountRecord,
): Tender247RunAccountContext {
  const paths = resolveTender247AccountAuthPaths({
    companyId: record.companyId,
    accountId: record.id,
  });
  const storageStatePath =
    record.sessionStoragePath &&
    fs.existsSync(resolveProjectPath(record.sessionStoragePath))
      ? resolveProjectPath(record.sessionStoragePath)
      : paths.storageStatePath;

  return {
    companyId: record.companyId,
    companyLabel: record.companyId === SIYANA_COMPANY_ID ? "SIYANA" : "COMPANY",
    accountId: record.id,
    accountLabel: record.label,
    accountShort: shortAccountId(record.id),
    username: record.username,
    password: record.password,
    storageStatePath,
    profileDir: paths.profileDir,
    seedExcelSubdir: path.join("accounts", record.id),
    logPrefix: buildAccountLogPrefix({
      companyLabel: record.companyId === SIYANA_COMPANY_ID ? "SIYANA" : "COMPANY",
      accountShort: shortAccountId(record.id),
    }),
  };
}

async function loadTender247AccountById(options: {
  companyId: string;
  accountId: string;
}): Promise<Tender247AccountRecord | null> {
  const { getSupabaseAdminClient, isSupabaseConfigured } = await import(
    "../supabase/client.js"
  );
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured; cannot load Tender247 account from DB.",
    );
  }
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agenttender_company_tender247_accounts")
    .select(
      "id, company_id, portal, label, username, encrypted_password, session_storage_path, is_active, sort_order",
    )
    .eq("company_id", options.companyId)
    .eq("id", options.accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (!data.is_active) {
    throw new Error(`Tender247 account is inactive: ${options.accountId}`);
  }
  return {
    id: String(data.id),
    companyId: String(data.company_id),
    portal: "TENDER247",
    label: String(data.label || "Account"),
    username: String(data.username),
    password: decryptSecret(String(data.encrypted_password)),
    sessionStoragePath: data.session_storage_path
      ? String(data.session_storage_path)
      : null,
    isActive: Boolean(data.is_active),
    sortOrder: Number(data.sort_order) || 0,
  };
}

export async function listActiveTender247Accounts(
  companyId: string,
): Promise<
  Array<{
    id: string;
    label: string;
    username: string;
    isActive: boolean;
    lastUsedAt: string | null;
  }>
> {
  const { getSupabaseAdminClient, isSupabaseConfigured } = await import(
    "../supabase/client.js"
  );
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agenttender_company_tender247_accounts")
    .select("id, label, username, is_active, last_used_at, sort_order")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: String(row.id),
    label: String(row.label),
    username: String(row.username),
    isActive: Boolean(row.is_active),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
  }));
}

export async function markTender247AccountUsed(accountId: string): Promise<void> {
  if (accountId === "legacy-env" || accountId.startsWith("env-")) return;
  const { getSupabaseAdminClient, isSupabaseConfigured } = await import(
    "../supabase/client.js"
  );
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabaseAdminClient();
  await supabase
    .from("agenttender_company_tender247_accounts")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", accountId);
}

export async function startPipelineRun(options: {
  companyId: string;
  tender247AccountId: string | null;
  runDate: string;
  mode?: string | null;
  resume?: boolean;
}): Promise<string | null> {
  const { getSupabaseAdminClient, isSupabaseConfigured } = await import(
    "../supabase/client.js"
  );
  if (!isSupabaseConfigured()) return null;
  const accountId =
    options.tender247AccountId &&
    options.tender247AccountId !== "legacy-env" &&
    !options.tender247AccountId.startsWith("env-")
      ? options.tender247AccountId
      : null;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agenttender_pipeline_runs")
    .insert({
      company_id: options.companyId,
      tender247_account_id: accountId,
      portal: "TENDER247",
      run_date: options.runDate,
      status: "running",
      mode: options.mode || null,
      resume: Boolean(options.resume),
    })
    .select("id")
    .single();
  if (error) {
    console.warn(`[pipeline_runs] insert failed: ${error.message}`);
    return null;
  }
  return String(data.id);
}

export async function finishPipelineRun(options: {
  runId: string | null;
  status: "success" | "completed_with_failures" | "failed";
  summary?: Record<string, unknown>;
}): Promise<void> {
  if (!options.runId) return;
  const { getSupabaseAdminClient, isSupabaseConfigured } = await import(
    "../supabase/client.js"
  );
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabaseAdminClient();
  await supabase
    .from("agenttender_pipeline_runs")
    .update({
      status: options.status,
      summary: options.summary || {},
      finished_at: new Date().toISOString(),
    })
    .eq("id", options.runId);
}

/** Credentials for login form — prefer active account context. */
export function resolveTender247LoginCredentials(): {
  email: string;
  password: string;
} {
  const ctx = getActiveTender247AccountContext();
  if (ctx?.username && ctx.password) {
    return { email: ctx.username, password: ctx.password };
  }
  return {
    email: process.env.TENDER247_EMAIL?.trim() || "",
    password: process.env.TENDER247_PASSWORD?.trim() || "",
  };
}
