export type BidassistResultMetadata = {
  stage: string | null;
  contractDate: string | null;
};

function valueForLabel(text: string, label: string): string | null {
  const match = text.match(
    new RegExp(`${label}(?=\\s|:|–|-|$)\\s*(?::|–|-)?\\s*([^\\n]+)`, "i"),
  );
  const value = match?.[1]?.trim().replace(/\\s+/g, " ");
  return value || null;
}

/** Remove the search-card's UI-only relative timestamp, not stage words. */
export function normalizeBidassistResultStage(value: string | null): string | null {
  if (!value) return null;
  const stage = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(
      /\s+(?:just now|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)$/i,
      "",
    )
    .trim();
  return stage || null;
}

function normalizeBidassistContractDate(value: string | null): string | null {
  if (!value) return null;
  const date = value.trim().replace(/\s+/g, " ");
  return /^(?:n\/?a|not available|-)$/i.test(date) ? null : date;
}

function usableResultStage(value: string | null): string | null {
  const stage = normalizeBidassistResultStage(value);
  // A one-character value is a parser artifact (for example, the "s" in
  // "Result Stages"), never a meaningful procurement stage.
  return stage && stage.length > 1 ? stage : null;
}

/** Extract search-card metadata before the scraper navigates into the result. */
export function parseBidassistResultMetadata(
  text: string,
): BidassistResultMetadata {
  return {
    stage: normalizeBidassistResultStage(valueForLabel(text, "Result Stage")),
    contractDate: normalizeBidassistContractDate(valueForLabel(text, "Contract Date")),
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
    stage: usableResultStage(incoming.stage) ?? usableResultStage(existing.stage),
    contractDate: incoming.contractDate ?? existing.contractDate,
  };
}
