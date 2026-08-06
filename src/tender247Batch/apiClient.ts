import type { APIRequestContext, BrowserContext, Page } from "playwright";
import type { Logger } from "../logger.js";
import type { ApiEnvelope, SessionContext } from "./types.js";

const API_BASE = "https://www.tender247.com/apigateway";

export function mailSearchUrl(): string {
  return `${API_BASE}/T247Tender/mail/api/tender/auth/search-tender`;
}

export function mailSearchCountUrl(): string {
  return `${API_BASE}/T247Tender/mail/api/tender/auth/tender-search-count`;
}

export function tenderDetailUrl(t247Id: string): string {
  return `${API_BASE}/T247Tender/api/tender/tender-detail/${t247Id}`;
}

export function tenderDocumentListUrl(t247Id: string): string {
  return `${API_BASE}/T247Tender/api/tender/tender-document-list/${t247Id}`;
}

export function aiSummaryUrl(): string {
  return `${API_BASE}/T247TenderAI/api/summary`;
}

export function buildSearchBody(
  session: SessionContext,
  pageNo: number,
  recordPerPage = 20,
): Record<string, unknown> {
  return {
    tab_id: 1,
    tender_id: 0,
    tender_number: "",
    search_text: "",
    refine_search_text: "",
    tender_value_operator: 0,
    tender_value_from: 0,
    tender_value_to: 0,
    publication_date_from: "",
    publication_date_to: "",
    closing_date_from: "",
    closing_date_to: "",
    search_by_location: false,
    statezone_ids: "",
    city_ids: "",
    state_ids: "",
    organization_ids: "",
    organization_name: "",
    sort_by: 1,
    sort_type: 2,
    page_no: pageNo,
    record_per_page: recordPerPage,
    keyword_id: "",
    mfa: "",
    nameof_website: "",
    tender_typeid: 0,
    is_tender_doc_uploaded: false,
    user_id: session.userId,
    user_email_service_query_id: session.userEmailServiceQueryId,
    exact_search: false,
    exact_search_text: false,
    search_by_split_word: false,
    product_id: "",
    organization_type_id: "",
    sub_industry_id: "",
    search_by: 0,
    guest_user_id: 0,
    quantity: "",
    quantity_operator: 0,
    msme_exemption: 0,
    startup_exemption: 0,
    gem: 0,
    mail_date: session.mailDate,
    tab_status: 0,
    is_ai_summary: false,
    boq: 0,
    is_grace: false,
    surety_bond: false,
    limited_tender: false,
    corrigendum_type: 0,
  };
}

export async function postJson<T>(
  request: APIRequestContext,
  url: string,
  body: unknown,
  logger: Logger,
  attempt = 1,
): Promise<ApiEnvelope<T>> {
  const maxAttempts = 5;
  const response = await request.post(url, {
    data: body ?? {},
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    timeout: 60_000,
  });

  const status = response.status();
  if (status === 429 || status >= 500) {
    if (attempt >= maxAttempts) {
      throw new Error(`API ${url} failed after retries: HTTP ${status}`);
    }
    const delayMs = Math.min(30_000, 1000 * 2 ** (attempt - 1));
    logger.warn(`HTTP ${status} from ${url}; backing off ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
    return postJson(request, url, body, logger, attempt + 1);
  }

  if (!response.ok()) {
    const text = await response.text().catch(() => "");
    throw new Error(`API ${url} HTTP ${status}: ${text.slice(0, 300)}`);
  }

  return (await response.json()) as ApiEnvelope<T>;
}

/**
 * Resolve user_id / query_id from authenticated page localStorage.
 * Falls back to user-login-query / subscription APIs when needed.
 */
export async function resolveSessionContext(
  page: Page,
  context: BrowserContext,
  mailDate: string,
  logger: Logger,
): Promise<SessionContext> {
  const fromStorage = await page.evaluate(() => {
    const rawUser = window.localStorage.getItem("userData");
    const rawQuery = window.localStorage.getItem("user_query_id");
    let userId: number | null = null;
    let queryId: number | null = null;
    if (rawUser) {
      try {
        const parsed = JSON.parse(rawUser) as Record<string, unknown>;
        const id =
          parsed.user_id ?? parsed.userId ?? parsed.UserId ?? parsed.id;
        if (typeof id === "number") {
          userId = id;
        } else if (typeof id === "string" && /^\d+$/.test(id)) {
          userId = Number(id);
        }
      } catch {
        // ignore
      }
    }
    if (rawQuery && /^\d+$/.test(rawQuery.trim())) {
      queryId = Number(rawQuery.trim());
    }
    return { userId, queryId };
  });

  let userId = fromStorage.userId;
  let userEmailServiceQueryId = fromStorage.queryId;

  if (!userId || !userEmailServiceQueryId) {
    logger.info("Resolving session context via subscription API");
    // Probe common user id paths from storage cookies is unreliable; call login query if we have userId
    if (userId) {
      const login = await postJson<
        Array<{ user_email_service_query_id?: string }>
      >(
        context.request,
        `${API_BASE}/T247ApiTender/api/auth/user-login-query`,
        { user_id: userId, company_service_id: 1, is_grace: false },
        logger,
      );
      const q = login.Data?.[0]?.user_email_service_query_id;
      if (q && /^\d+$/.test(String(q))) {
        userEmailServiceQueryId = Number(q);
      }
    }
  }

  if (!userId || !userEmailServiceQueryId) {
    throw new Error(
      `Could not resolve Tender247 session context (userId=${userId}, queryId=${userEmailServiceQueryId})`,
    );
  }

  logger.info(
    `Session context ready user_id=${userId} query_id=${userEmailServiceQueryId} mail_date=${mailDate}`,
  );

  return {
    userId,
    userEmailServiceQueryId,
    mailDate,
  };
}

export function buildDetailPageUrl(
  t247Id: string,
  securityCode: string,
  submissionEndDate?: string | null,
): string {
  const base = `https://www.tender247.com/auth/tender/${t247Id}/${securityCode}`;
  if (submissionEndDate) {
    return `${base}?tesd=${encodeURIComponent(submissionEndDate)}`;
  }
  return base;
}
