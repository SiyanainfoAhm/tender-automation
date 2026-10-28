/**
 * Recorded tender reasons sometimes hold internal pipeline codes such as
 * "EVIDENCE_PENDING — Error: Error: DEPENDENCY_PENDING:TARGETED_SOURCE_ACQUISITION".
 * Show users a plain explanation instead, and keep any human-written part.
 */
function isMachineText(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  if (/\b(?:Error|Exception|DEPENDENCY_PENDING|EVIDENCE_PENDING|TIMEOUT)\b/.test(s)) return true;
  const words = s.split(/\s+/);
  const codes = words.filter((w) => /^[A-Z0-9]+(?:_[A-Z0-9]+)+[:.,;]?$/.test(w)).length;
  return codes > 0 && codes / words.length > 0.25;
}

function describePipelineReason(text: string): string {
  if (/TENDER247_ACQUISITION_REQUIRED|SOURCE_ACQUISITION_BLOCKED/i.test(text))
    return "Evaluation pending: the tender documents have not been downloaded from the portal yet.";
  if (/TARGETED_SOURCE_ACQUISITION/i.test(text))
    return "Evaluation pending: some tender documents are still being collected.";
  if (/MISSING_SOURCE_EVIDENCE/i.test(text))
    return "The full RFP document was not available, so eligibility could not be checked.";
  if (/EVIDENCE_REFRESH_REQUIRED/i.test(text))
    return "Evaluation pending: the tender documents changed and will be re-checked.";
  if (/PREPARATION|WORKER_RESOURCE_LIMIT|compute resources/i.test(text))
    return "Evaluation pending: document processing failed temporarily and will be retried.";
  return "Evaluation pending: the automatic check has not finished yet.";
}

export function friendlyTenderReason(raw: string | null | undefined): string {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const parts = text.split(/\s+\|\s+/);
  if (!parts.some(isMachineText)) return text;
  const human = parts
    .filter((part) => !isMachineText(part))
    .map((part) =>
      part.replace(/^Removed from [A-Z_ -]+ (\d{4}-\d{2}-\d{2}) by user:\s*/i, "Marked by user on $1: "),
    );
  return human.length ? human.join(" ") : describePipelineReason(text);
}
