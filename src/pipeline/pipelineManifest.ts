import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../fileUtils.js";
import { getTodayIsoDate } from "../dateUtils.js";

export type PipelineSourcePortal = "TENDER247" | "BIDASSIST";

export interface PipelineManifest {
  runId: string;
  sourcePortal: PipelineSourcePortal;
  startedAt: string;
  finishedAt?: string | null;
  selectedTenderIds: string[];
  completedCrawlerTenderIds: string[];
  failedCrawlerTenderIds: string[];
  qualifiedTenderIds?: string[];
  failedQualificationTenderIds?: string[];
}

export function pipelineManifestsDir(downloadRoot: string, dateIso?: string): string {
  const date = dateIso || getTodayIsoDate();
  return path.resolve(downloadRoot, date, "pipeline-manifests");
}

export function createPipelineRunId(sourcePortal: PipelineSourcePortal): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${sourcePortal.toLowerCase()}-${stamp}`;
}

export function writePipelineManifest(
  downloadRoot: string,
  manifest: PipelineManifest,
  dateIso?: string,
): string {
  const dir = pipelineManifestsDir(downloadRoot, dateIso);
  ensureDir(dir);
  const outPath = path.join(dir, `${manifest.runId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`PIPELINE_MANIFEST_CREATED=${outPath}`);
  return outPath;
}

export function readPipelineManifest(manifestPath: string): PipelineManifest {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PipelineManifest;
}

export function loadLatestPipelineManifest(
  downloadRoot: string,
  sourcePortal: PipelineSourcePortal,
  dateIso?: string,
): PipelineManifest | null {
  const dir = pipelineManifestsDir(downloadRoot, dateIso);
  if (!fs.existsSync(dir)) {
    return null;
  }
  const files = fs
    .readdirSync(dir)
    .filter(
      (name) =>
        name.startsWith(`${sourcePortal.toLowerCase()}-`) &&
        name.endsWith(".json"),
    )
    .map((name) => path.join(dir, name))
    .sort(
      (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs,
    );
  if (!files[0]) {
    return null;
  }
  return readPipelineManifest(files[0]);
}

/** Qualification may only process IDs from the current run manifest. */
export function selectManifestQualificationIds(
  manifest: PipelineManifest,
): string[] {
  const completed = new Set(manifest.completedCrawlerTenderIds);
  return manifest.selectedTenderIds.filter((id) => completed.has(id));
}
