/**
 * Current-tender document download stage. The detail page must not close
 * (and the next selected tender must not open) while this is downloading
 * or verifying.
 */
export type TenderDocumentStage =
  | "not_started"
  | "downloading"
  | "verifying"
  | "success"
  | "unavailable"
  | "failed";

export type TenderDocumentStageTracker = {
  t247Id: string;
  get(): TenderDocumentStage;
  set(next: TenderDocumentStage): void;
};

export class TenderDocumentStageCloseError extends Error {
  readonly code = "REFUSING_TO_CLOSE_TENDER";
  constructor(t247Id: string, stage: TenderDocumentStage) {
    super(`REFUSING_TO_CLOSE_TENDER_${t247Id}: document stage still active (${stage})`);
    this.name = "TenderDocumentStageCloseError";
  }
}

const TERMINAL: ReadonlySet<TenderDocumentStage> = new Set([
  "not_started",
  "success",
  "unavailable",
  "failed",
]);

export function isTerminalDocumentStage(stage: TenderDocumentStage): boolean {
  return TERMINAL.has(stage);
}

export function createDocumentStageTracker(
  t247Id: string,
): TenderDocumentStageTracker {
  let stage: TenderDocumentStage = "not_started";
  return {
    t247Id,
    get: () => stage,
    set: (next) => {
      stage = next;
    },
  };
}

export function assertCanCloseTenderDetailPage(
  tracker: TenderDocumentStageTracker | null | undefined,
  t247Id?: string,
): void {
  if (!tracker) return;
  const stage = tracker.get();
  if (stage === "downloading" || stage === "verifying") {
    throw new TenderDocumentStageCloseError(t247Id || tracker.t247Id, stage);
  }
}

export function t247Event(
  logger: { info: (msg: string) => void },
  t247Id: string,
  event: string,
): void {
  logger.info(`[T247 ${t247Id}] ${event}`);
}
