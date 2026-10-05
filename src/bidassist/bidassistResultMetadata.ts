export type BidassistResultMetadata = {
  stage: string | null;
  contractDate: string | null;
};

function valueForLabel(text: string, label: string): string | null {
  const match = text.match(
    new RegExp(`${label}\\s*(?::|–|-)?\\s*([^\\n]+)`, "i"),
  );
  const value = match?.[1]?.trim().replace(/\\s+/g, " ");
  return value || null;
}

/** Extract search-card metadata before the scraper navigates into the result. */
export function parseBidassistResultMetadata(
  text: string,
): BidassistResultMetadata {
  return {
    stage: valueForLabel(text, "Result Stage"),
    contractDate: valueForLabel(text, "Contract Date"),
  };
}

/** Detail values win only when actually present; missing detail fields keep card data. */
export function mergeBidassistResultMetadata(
  search: BidassistResultMetadata,
  detail: BidassistResultMetadata,
): BidassistResultMetadata {
  return {
    stage: detail.stage ?? search.stage,
    contractDate: detail.contractDate ?? search.contractDate,
  };
}

/** A transient scrape gap must never erase previously persisted result fields. */
export function preserveBidassistResultMetadata(
  existing: BidassistResultMetadata,
  incoming: BidassistResultMetadata,
): BidassistResultMetadata {
  return {
    stage: incoming.stage ?? existing.stage,
    contractDate: incoming.contractDate ?? existing.contractDate,
  };
}
