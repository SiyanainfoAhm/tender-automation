/**
 * Resolve a Tender247 detail page by ID using the production single-tender path.
 * Reuses openSingleTenderDirectly — no private search-tender API / bearer tokens.
 */
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { openSingleTenderDirectly } from "../tenderDetails/openSingleTenderDirectly.js";
import type { TenderListItem } from "../tenderDetails/types.js";

export type ResolvedTender247Detail = {
  detailPage: Page;
  item: TenderListItem;
  detailUrl: string;
};

/**
 * Authenticated browser list page → locate T247 ID → open detail tab.
 * Same path as `npm run crawl:tender247:one`.
 */
export async function resolveTender247Tender(options: {
  listPage: Page;
  context: BrowserContext;
  tenderId: string;
  config: AppConfig;
  logger: Logger;
}): Promise<ResolvedTender247Detail> {
  const opened = await openSingleTenderDirectly(
    options.listPage,
    options.context,
    options.tenderId,
    options.config,
    options.logger,
  );
  return {
    detailPage: opened.page,
    item: opened.item,
    detailUrl: opened.item.detailUrl || opened.page.url(),
  };
}
