/**
 * The Tender247 partner-feed contract is intentionally opt-in.  `scrapedDate`
 * is an application processing label, not an upstream field name.
 *
 * Do not set VERIFIED from observed responses alone.  It requires written
 * provider documentation (or a provider-approved test) covering every field
 * below.
 */
export type Tender247UpstreamContract = {
  evidence: string;
  dateFilter: {
    field: "creation" | "publication" | "update" | "closing";
    timezone: string;
    boundary: "INCLUSIVE_CALENDAR_DATE" | "HALF_OPEN_CALENDAR_DATE";
    startParam: string;
    endParam: string;
  };
  pagination: {
    mode: "PAGE_NUMBER";
    pageParam: string;
    pageSizeParam: string;
    pageSize: number;
    firstPage: number;
    totalCountField: string;
  };
};

/**
 * COMPATIBILITY_UNVERIFIED is an explicit acknowledgement that we are using
 * the observed, unfiltered Tender247 request shape. It is not a provider
 * verification and must never be reported as source-date complete.
 */
export type Tender247SyncMode = "VERIFIED" | "COMPATIBILITY_UNVERIFIED";

export function tender247SyncMode(env: NodeJS.ProcessEnv = process.env): Tender247SyncMode {
  const status = env.TENDER247_UPSTREAM_CONTRACT_STATUS?.trim();
  if (status === "COMPATIBILITY_UNVERIFIED") return status;
  if (status === "VERIFIED") {
    parseTender247UpstreamContract(env);
    return status;
  }
  throw new Error("TENDER247_UPSTREAM_CONTRACT_STATUS must be COMPATIBILITY_UNVERIFIED or VERIFIED. UNVERIFIED disables synchronization.");
}

const paramName = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value);

const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function validTimeZone(value: unknown): value is string {
  if (!text(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
  catch { return false; }
}

export function tender247UpstreamContractError(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    tender247SyncMode(env);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Tender247 upstream contract configuration is invalid.";
  }
}

export function parseTender247UpstreamContract(env: NodeJS.ProcessEnv = process.env): Tender247UpstreamContract {
  const raw = env.TENDER247_UPSTREAM_CONTRACT_JSON?.trim();
  if (!raw) throw new Error("TENDER247_UPSTREAM_CONTRACT_JSON is required when the contract is VERIFIED.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("TENDER247_UPSTREAM_CONTRACT_JSON must be valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TENDER247_UPSTREAM_CONTRACT_JSON must be an object.");
  const contract = value as Partial<Tender247UpstreamContract>;
  const date = contract.dateFilter;
  const pagination = contract.pagination;
  if (!text(contract.evidence)) throw new Error("Tender247 contract evidence is required (provider document URL/version or approved support case).");
  if (!date || !["creation", "publication", "update", "closing"].includes(date.field || "")) throw new Error("Tender247 dateFilter.field must identify creation, publication, update, or closing.");
  if (!validTimeZone(date.timezone)) throw new Error("Tender247 dateFilter.timezone must be an IANA timezone.");
  if (date.boundary !== "INCLUSIVE_CALENDAR_DATE" && date.boundary !== "HALF_OPEN_CALENDAR_DATE") throw new Error("Tender247 dateFilter.boundary must be explicit.");
  if (!paramName(date.startParam) || !paramName(date.endParam) || date.startParam === date.endParam) throw new Error("Tender247 date filter parameter names are invalid.");
  if (!pagination || pagination.mode !== "PAGE_NUMBER") throw new Error("Tender247 pagination.mode must be PAGE_NUMBER.");
  if (!paramName(pagination.pageParam) || !paramName(pagination.pageSizeParam) || !paramName(pagination.totalCountField)) throw new Error("Tender247 pagination parameter/count field names are invalid.");
  if (!Number.isSafeInteger(pagination.pageSize) || pagination.pageSize < 1 || pagination.pageSize > 1000) throw new Error("Tender247 pagination.pageSize must be an integer between 1 and 1000.");
  if (!Number.isSafeInteger(pagination.firstPage) || pagination.firstPage < 0) throw new Error("Tender247 pagination.firstPage must be a non-negative integer.");
  return contract as Tender247UpstreamContract;
}

export function providerDateBounds(scrapedDate: string, contract: Tender247UpstreamContract): Record<string, string> {
  // The processing date remains separate from this query.  The supplied
  // contract defines whether a same-day end is inclusive or next-day exclusive.
  const end = new Date(`${scrapedDate}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) throw new Error("scrapedDate must be a YYYY-MM-DD calendar date.");
  if (contract.dateFilter.boundary === "HALF_OPEN_CALENDAR_DATE") end.setUTCDate(end.getUTCDate() + 1);
  return { [contract.dateFilter.startParam]: scrapedDate, [contract.dateFilter.endParam]: end.toISOString().slice(0, 10) };
}
