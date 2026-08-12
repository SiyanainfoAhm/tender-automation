/**
 * Resolve Tender247 security_code for specific IDs via today's mail search API.
 * Never invents codes — only returns values present in API responses.
 */
import type { BrowserContext, Page } from "playwright";
import type { Logger } from "../logger.js";
import {
  buildSearchBody,
  mailSearchUrl,
  postJson,
  resolveSessionContext,
} from "./apiClient.js";
import type { SearchTenderRow } from "./types.js";

export async function lookupTender247SecurityCodes(options: {
  page: Page;
  context: BrowserContext;
  mailDate: string;
  tenderIds: string[];
  logger: Logger;
}): Promise<Map<string, string>> {
  const wanted = new Set(options.tenderIds);
  const found = new Map<string, string>();
  if (wanted.size === 0) {
    return found;
  }

  const session = await resolveSessionContext(
    options.page,
    options.context,
    options.mailDate,
    options.logger,
  );

  let pageNo = 1;
  const pageSize = 50;
  while (pageNo <= 500 && found.size < wanted.size) {
    const body = buildSearchBody(session, pageNo, pageSize);
    const res = await postJson<SearchTenderRow[]>(
      options.context.request,
      mailSearchUrl(),
      body,
      options.logger,
    );
    const rows = Array.isArray(res.Data) ? res.Data : [];
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      const id = String(row.tender_id);
      if (!wanted.has(id) || found.has(id)) continue;
      if (row.security_code && String(row.security_code).trim()) {
        found.set(id, String(row.security_code).trim());
      }
    }
    if (rows.length < pageSize) {
      break;
    }
    pageNo += 1;
  }

  options.logger.info(
    `KEPT_PIPELINE_SECURITY_CODES_RESOLVED=${found.size}/${wanted.size}`,
  );
  return found;
}
