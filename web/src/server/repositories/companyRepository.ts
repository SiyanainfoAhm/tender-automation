import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import { SIYANA_COMPANY_ID } from "@/lib/company/types";
import { parseStoredScopeList } from "@/lib/company/scope-chips";
import {
  mergeScreeningPoliciesIntoExtras,
  parseScreeningPolicies,
  type ScreeningPolicies,
} from "@/lib/company/screening-policies";

export type CompanyRecord = {
  id: string;
  name: string;
  industryType: string | null;
  businessLocation: string | null;
  website: string | null;
  yearEstablished: number | null;
  description: string | null;
  slug: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompanyBidPreferences = {
  id: string;
  companyId: string;
  maxEmdInr: number | null;
  minTenderValueInr: number | null;
  maxTenderValueInr: number | null;
  serviceScope: string[];
  excludedScope: string[];
  extras: Record<string, unknown>;
  screeningPolicies: ScreeningPolicies;
  updatedAt: string;
};

function mapCompany(row: Record<string, unknown>): CompanyRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    industryType: (row.industry_type as string) || null,
    businessLocation: (row.business_location as string) || null,
    website: (row.website as string) || null,
    yearEstablished:
      row.year_established == null ? null : Number(row.year_established),
    description: (row.description as string) || null,
    slug: (row.slug as string) || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPrefs(row: Record<string, unknown>): CompanyBidPreferences {
  const service = row.service_scope;
  const excluded = row.excluded_scope;
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    maxEmdInr: row.max_emd_inr == null ? null : Number(row.max_emd_inr),
    minTenderValueInr:
      row.min_tender_value_inr == null ? null : Number(row.min_tender_value_inr),
    maxTenderValueInr:
      row.max_tender_value_inr == null ? null : Number(row.max_tender_value_inr),
    serviceScope: parseStoredScopeList(service),
    excludedScope: parseStoredScopeList(excluded),
    extras: (row.extras as Record<string, unknown>) || {},
    screeningPolicies: parseScreeningPolicies(
      (row.extras as Record<string, unknown>) || {},
    ),
    updatedAt: String(row.updated_at),
  };
}

export async function getCompanyById(
  companyId: string,
): Promise<CompanyRecord | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_companies")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCompany(data as Record<string, unknown>) : null;
}

export async function updateCompanyProfile(
  companyId: string,
  patch: {
    name: string;
    industryType?: string | null;
    businessLocation?: string | null;
    website?: string | null;
    yearEstablished?: number | null;
    description?: string | null;
  },
): Promise<CompanyRecord> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_companies")
    .update({
      name: patch.name.trim(),
      industry_type: patch.industryType?.trim() || null,
      business_location: patch.businessLocation?.trim() || null,
      website: patch.website?.trim() || null,
      year_established: patch.yearEstablished ?? null,
      description: patch.description?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapCompany(data as Record<string, unknown>);
}

export async function getCompanyBidPreferences(
  companyId: string,
): Promise<CompanyBidPreferences | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_bid_preferences")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapPrefs(data as Record<string, unknown>) : null;
}

export async function upsertCompanyBidPreferences(
  companyId: string,
  patch: {
    maxEmdInr?: number | null;
    minTenderValueInr?: number | null;
    maxTenderValueInr?: number | null;
    serviceScope?: string[];
    excludedScope?: string[];
    screeningPolicies?: ScreeningPolicies;
  },
): Promise<CompanyBidPreferences> {
  const supabase = getServerSupabase();
  const existing = await getCompanyBidPreferences(companyId);
  const extras = patch.screeningPolicies
    ? mergeScreeningPoliciesIntoExtras(existing?.extras, patch.screeningPolicies)
    : existing?.extras ?? {};
  const payload = {
    company_id: companyId,
    max_emd_inr: patch.maxEmdInr ?? existing?.maxEmdInr ?? null,
    min_tender_value_inr:
      patch.minTenderValueInr ?? existing?.minTenderValueInr ?? null,
    max_tender_value_inr:
      patch.maxTenderValueInr ?? existing?.maxTenderValueInr ?? null,
    service_scope: patch.serviceScope ?? existing?.serviceScope ?? [],
    excluded_scope: patch.excludedScope ?? existing?.excludedScope ?? [],
    extras,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("agenttender_company_bid_preferences")
    .upsert(payload, { onConflict: "company_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapPrefs(data as Record<string, unknown>);
}

export async function createCompany(options: {
  name: string;
  industryType?: string | null;
  businessLocation?: string | null;
  website?: string | null;
}): Promise<CompanyRecord> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_companies")
    .insert({
      name: options.name.trim(),
      industry_type: options.industryType?.trim() || null,
      business_location: options.businessLocation?.trim() || null,
      website: options.website?.trim() || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const company = mapCompany(data as Record<string, unknown>);

  // Default prefs from automation screening defaults (not screenshot)
  await supabase.from("agenttender_company_bid_preferences").insert({
    company_id: company.id,
    max_emd_inr: 1_500_000,
    min_tender_value_inr: null,
    max_tender_value_inr: 50_000_000,
    service_scope: [],
    excluded_scope: [],
  });

  return company;
}

export function getSiyanaCompanyId(): string {
  return SIYANA_COMPANY_ID;
}
