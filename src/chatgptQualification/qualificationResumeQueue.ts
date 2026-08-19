/**
 * Resume ChatGPT qualification queue: ALL currently artifact-ready Phase-1
 * tenders that still lack a valid individual qualification.
 *
 * Never derived from this-run crawl/repair/completion lists.
 */
import path from "node:path";
import {
  isDetailScrapeCrawlStatus,
} from "../runScreening/phase1Statuses.js";
import { loadPhase1DecisionsFromDisk } from "../runScreening/phase1DetailQueue.js";
import {
  inspectTenderArtifactState,
  listT247TenderDirs,
  tenderDirForId,
} from "../tender247Batch/tenderArtifactState.js";
import {
  hasPendingExistingConversation,
  loadChatGptTenderState,
} from "./chatgptState.js";
import { evaluateExistingQualificationReuse } from "./existingQualificationReuse.js";
import {
  assertGptQueueIntegrity,
  planGptQualificationQueue,
  type GptQueuePlan,
} from "./gptQueuePlan.js";

export type QualificationResumeUniverse = {
  phase1CandidateIds: string[];
  gptReadyIds: string[];
  notReadyIds: string[];
  reusedIds: string[];
  pendingIds: string[];
  source: "phase1_workbook" | "disk_folders";
};

export function listPhase1QualificationCandidateIds(
  dateFolder: string,
): string[] | null {
  const decisions = loadPhase1DecisionsFromDisk(dateFolder);
  if (!decisions) return null;
  const ids: string[] = [];
  for (const decision of decisions.values()) {
    if (isDetailScrapeCrawlStatus(decision.status)) {
      ids.push(decision.tender247Id);
    }
  }
  return ids.sort((a, b) => Number(a) - Number(b));
}

export function isQualificationArtifactReady(
  dateFolder: string,
  t247Id: string,
): boolean {
  return inspectTenderArtifactState(
    tenderDirForId(dateFolder, t247Id),
    t247Id,
  ).qualificationReady;
}

export function classifyPhase1QualificationReady(
  dateFolder: string,
  phase1CandidateIds: string[],
): { gptReadyIds: string[]; notReadyIds: string[] } {
  const gptReadyIds: string[] = [];
  const notReadyIds: string[] = [];
  for (const id of phase1CandidateIds) {
    if (isQualificationArtifactReady(dateFolder, id)) {
      gptReadyIds.push(id);
    } else {
      notReadyIds.push(id);
    }
  }
  return { gptReadyIds, notReadyIds };
}

export function inspectQualificationResumeUniverse(options: {
  dateFolder: string;
  resumeMode: boolean;
}): QualificationResumeUniverse {
  const phase1Ids = listPhase1QualificationCandidateIds(options.dateFolder);
  const source = phase1Ids ? "phase1_workbook" : "disk_folders";
  const phase1CandidateIds = phase1Ids ?? listT247TenderDirs(options.dateFolder).map((row) => row.t247Id);
  const { gptReadyIds, notReadyIds } = classifyPhase1QualificationReady(
    options.dateFolder,
    phase1CandidateIds,
  );

  const reusedIds: string[] = [];
  const pendingIds: string[] = [];
  for (const t247Id of gptReadyIds) {
    const reuse = evaluateExistingQualificationReuse({
      dateFolder: options.dateFolder,
      sourceTenderId: t247Id,
      resumeMode: options.resumeMode,
    });
    if (options.resumeMode && reuse.reuse) {
      reusedIds.push(t247Id);
      continue;
    }
    const tenderFolder = path.join(options.dateFolder, `T247-${t247Id}`);
    if (
      options.resumeMode &&
      hasPendingExistingConversation(loadChatGptTenderState(tenderFolder))
    ) {
      pendingIds.push(t247Id);
    }
  }

  return {
    phase1CandidateIds,
    gptReadyIds,
    notReadyIds,
    reusedIds,
    pendingIds,
    source,
  };
}

export function planResumeQualificationQueue(options: {
  universe: QualificationResumeUniverse;
  maxGptSends: number;
  alreadyCompletedIds?: string[];
}): GptQueuePlan {
  const plan = planGptQualificationQueue({
    readyIds: options.universe.gptReadyIds,
    notReadyIds: options.universe.notReadyIds,
    reusedIds: options.universe.reusedIds,
    pendingRecoveryIds: options.universe.pendingIds,
    alreadyCompletedIds: options.alreadyCompletedIds,
    maxGptSends: options.maxGptSends,
  });
  assertGptQueueIntegrity(plan);
  return plan;
}
