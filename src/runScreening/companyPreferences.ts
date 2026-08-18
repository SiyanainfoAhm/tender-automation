/**
 * Load Siyana company + bid preferences from the application database.
 * Table: agenttender_companies / agenttender_company_bid_preferences
 */
import crypto from "node:crypto";
import { resolveRunCompanyId } from "../company/siyanaCompany.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "../supabase/client.js";

export type CompanyScreeningProfile = {
  id: string;
  name: string;
  industryType: string | null;
  businessLocation: string | null;
  website: string | null;
  yearEstablished: number | null;
  description: string | null;
  slug: string | null;
};

export type CompanyBidPreferenceSnapshot = {
  companyId: string;
  maxEmdInr: number | null;
  minTenderValueInr: number | null;
  maxTenderValueInr: number | null;
  serviceScope: string[];
  excludedScope: string[];
  extras: Record<string, unknown>;
  updatedAt: string | null;
};

export type CompanyPreferenceSnapshot = {
  company: CompanyScreeningProfile;
  preferences: CompanyBidPreferenceSnapshot;
  loadedAt: string;
};

function asStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).replace(/\s+/g, " ").trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return asStringArray(parsed);
    } catch {
      return raw
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function mapCompany(row: Record<string, unknown>): CompanyScreeningProfile {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    industryType: row.industry_type == null ? null : String(row.industry_type),
    businessLocation:
      row.business_location == null ? null : String(row.business_location),
    website: row.website == null ? null : String(row.website),
    yearEstablished:
      row.year_established == null ? null : Number(row.year_established),
    description: row.description == null ? null : String(row.description),
    slug: row.slug == null ? null : String(row.slug),
  };
}

function mapPrefs(
  companyId: string,
  row: Record<string, unknown> | null,
): CompanyBidPreferenceSnapshot {
  if (!row) {
    return {
      companyId,
      maxEmdInr: null,
      minTenderValueInr: null,
      maxTenderValueInr: null,
      serviceScope: [],
      excludedScope: [],
      extras: {},
      updatedAt: null,
    };
  }
  const extras =
    row.extras && typeof row.extras === "object" && !Array.isArray(row.extras)
      ? (row.extras as Record<string, unknown>)
      : {};
  return {
    companyId: String(row.company_id ?? companyId),
    maxEmdInr: row.max_emd_inr == null ? null : Number(row.max_emd_inr),
    minTenderValueInr:
      row.min_tender_value_inr == null ? null : Number(row.min_tender_value_inr),
    maxTenderValueInr:
      row.max_tender_value_inr == null ? null : Number(row.max_tender_value_inr),
    serviceScope: asStringArray(row.service_scope),
    excludedScope: asStringArray(row.excluded_scope),
    extras,
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
  };
}

export function hashPreferenceSnapshot(snapshot: CompanyPreferenceSnapshot): string {
  const payload = JSON.stringify({
    company: snapshot.company,
    preferences: snapshot.preferences,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function loadCompanyPreferenceSnapshot(
  companyId = resolveRunCompanyId(),
): Promise<CompanyPreferenceSnapshot> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "SCREENING_PREFERENCES_UNAVAILABLE: Supabase is not configured; cannot load company preferences",
    );
  }
  const client = getSupabaseAdminClient();
  const { data: companyRow, error: companyError } = await client
    .from("agenttender_companies")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) {
    throw new Error(`SCREENING_PREFERENCES_UNAVAILABLE: ${companyError.message}`);
  }
  if (!companyRow) {
    throw new Error(
      `SCREENING_PREFERENCES_UNAVAILABLE: company ${companyId} not found`,
    );
  }

  const { data: prefsRow, error: prefsError } = await client
    .from("agenttender_company_bid_preferences")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (prefsError) {
    throw new Error(`SCREENING_PREFERENCES_UNAVAILABLE: ${prefsError.message}`);
  }

  return {
    company: mapCompany(companyRow as Record<string, unknown>),
    preferences: mapPrefs(companyId, (prefsRow as Record<string, unknown> | null) ?? null),
    loadedAt: new Date().toISOString(),
  };
}
