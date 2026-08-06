import type { ItRelevance } from "./prescreenTypes.js";

/** Deterministic IT-scope classifier — Tender247 only. */

const RELEVANT_PATTERNS: RegExp[] = [
  /\bsoftware\s+development\b/i,
  /\b(web\s*)?site\b/i,
  /\bportal\b/i,
  /\bmobile\s+app(lication)?\b/i,
  /\bandroid\b/i,
  /\bios\b/i,
  /\berp\b/i,
  /\bmis\b/i,
  /\bhrms\b/i,
  /\bgis\b/i,
  /\bdashboard\b/i,
  /\bsystem\s+integration\b/i,
  /\bapi\s+integration\b/i,
  /\bit\s+services?\b/i,
  /\bit\s+support\b/i,
  /\bapplication\s+maintenance\b/i,
  /\bcloud\b/i,
  /\bdatabase\b/i,
  /\bcyber\s*security\b/i,
  /\binformation\s+security\b/i,
  /\bnetwork\s+management\b/i,
  /\bdigital\s+platform\b/i,
  /\btechnology\s+consulting\b/i,
  /\bit[- ]?enabled\s+services?\b/i,
  /\bsoftware\b/i,
  /\binformation\s+technology\b/i,
  /\bict\b/i,
  /\bsaas\b/i,
  /\bapplication\s+development\b/i,
  /\bweb\s+application\b/i,
  /\bcomputerization\b/i,
  /\be[- ]?governance\b/i,
];

const NON_IT_PATTERNS: RegExp[] = [
  /\bcivil\s+construction\b/i,
  /\broad(s|work)?\b/i,
  /\bbuilding\s+work\b/i,
  /\belectrical\s+equipment\s+supply\b/i,
  /\bmechanical\s+repair/i,
  /\bvehicle\s+procurement\b/i,
  /\breal\s+estate\b/i,
  /\bmedical\s+consumables?\b/i,
  /\bfood\b/i,
  /\bcatering\b/i,
  /\bhousekeeping\b/i,
  /\bsecurity\s+guards?\b/i,
  /\bscanning[- ]only\b/i,
  /\bdocument\s+digitization[- ]only\b/i,
  /\bprinting[- ]only\b/i,
  /\bconstruction\b/i,
  /\bfurniture\b/i,
  /\bmanpower\s+supply\b/i,
  /\bcivil\s+works?\b/i,
  /\bpipeline\s+laying\b/i,
  /\bborewell\b/i,
];

export type ItRelevanceClassifierCallTracker = {
  called: boolean;
  sourcePortal?: string;
};

/**
 * Classify Tender247 title/description/category for IT relevance.
 * Must never be invoked for BidAssist.
 */
export function classifyTender247ItRelevance(
  text: string,
  tracker?: ItRelevanceClassifierCallTracker,
): ItRelevance {
  if (tracker) {
    tracker.called = true;
    tracker.sourcePortal = "TENDER247";
  }

  const haystack = text.trim();
  if (!haystack) {
    return "AMBIGUOUS";
  }

  const hasRelevant = RELEVANT_PATTERNS.some((p) => p.test(haystack));
  const hasNonIt = NON_IT_PATTERNS.some((p) => p.test(haystack));

  if (hasNonIt && !hasRelevant) {
    return "NON_IT";
  }
  if (hasRelevant && !hasNonIt) {
    return "RELEVANT";
  }
  if (hasRelevant && hasNonIt) {
    // Mixed signals — prefer relevant when IT terms are present
    return "RELEVANT";
  }
  return "AMBIGUOUS";
}

export function assertBidassistDidNotRunItClassifier(
  sourcePortal: string,
  tracker: ItRelevanceClassifierCallTracker,
): void {
  if (sourcePortal === "BIDASSIST" && tracker.called) {
    throw new Error("BIDASSIST_IT_RELEVANCE_CLASSIFIER_MUST_NOT_RUN");
  }
}
