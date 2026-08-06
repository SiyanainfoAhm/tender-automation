import fs from "node:fs";
import path from "node:path";
import { ZipArchive } from "archiver";
import type { Logger } from "../logger.js";

/**
 * Create T247-{ID}.zip containing a top-level T247-{ID}/ folder.
 * Writes to .tmp first, waits for stream `close`, validates size, then renames.
 */
export async function createTenderZip(options: {
  tenderFolderPath: string;
  zipPath: string;
  t247Id: string;
  logger: Logger;
}): Promise<{ zipPath: string; sizeBytes: number }> {
  const { tenderFolderPath, zipPath, t247Id, logger } = options;
  const folderName = `T247-${t247Id}`;
  const temporaryZipPath = `${zipPath}.tmp`;

  if (!fs.existsSync(tenderFolderPath)) {
    throw new Error(`Tender folder missing: ${tenderFolderPath}`);
  }

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  await fs.promises.rm(temporaryZipPath, { force: true });

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(temporaryZipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    let settled = false;
    const fail = (err: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const ok = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    output.on("close", ok);
    output.on("error", fail);
    archive.on("error", fail);
    archive.on("warning", (err: Error & { code?: string }) => {
      if (err.code === "ENOENT") {
        logger.warn(`ZIP_WARNING: ${err.message}`);
      } else {
        fail(err);
      }
    });

    archive.pipe(output);
    archive.directory(tenderFolderPath, folderName);
    void Promise.resolve(archive.finalize()).catch(fail);
  });

  const stat = await fs.promises.stat(temporaryZipPath);
  if (stat.size <= 0) {
    await fs.promises.rm(temporaryZipPath, { force: true });
    throw new Error("TENDER_ZIP_EMPTY");
  }

  await fs.promises.rm(zipPath, { force: true });
  await fs.promises.rename(temporaryZipPath, zipPath);

  const finalStat = await fs.promises.stat(zipPath);
  if (finalStat.size <= 0) {
    throw new Error("TENDER_ZIP_EMPTY");
  }

  logger.info(`ZIP_CREATED=${path.basename(zipPath)}`);
  logger.info(`ZIP_SIZE=${finalStat.size}`);
  return { zipPath, sizeBytes: finalStat.size };
}

export async function createDailyMasterZip(options: {
  dateFolder: string;
  dateIso: string;
  zipPaths: string[];
  logger: Logger;
}): Promise<string | null> {
  const { dateFolder, dateIso, zipPaths, logger } = options;
  const existing = zipPaths.filter(
    (p) => fs.existsSync(p) && fs.statSync(p).size > 0,
  );
  if (existing.length === 0) {
    logger.warn("No tender ZIP files available for master ZIP");
    return null;
  }

  const masterPath = path.join(dateFolder, `Tender247_All_${dateIso}.zip`);
  const temporaryZipPath = `${masterPath}.tmp`;
  await fs.promises.rm(temporaryZipPath, { force: true });

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(temporaryZipPath);
    const archive = new ZipArchive({ zlib: { level: 1 } });
    let settled = false;
    const fail = (err: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const ok = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    output.on("close", ok);
    output.on("error", fail);
    archive.on("error", fail);
    archive.pipe(output);
    for (const zip of existing) {
      archive.file(zip, { name: path.basename(zip) });
    }
    void Promise.resolve(archive.finalize()).catch(fail);
  });

  const stat = await fs.promises.stat(temporaryZipPath);
  if (stat.size <= 0) {
    await fs.promises.rm(temporaryZipPath, { force: true });
    throw new Error("MASTER_ZIP_EMPTY");
  }
  await fs.promises.rm(masterPath, { force: true });
  await fs.promises.rename(temporaryZipPath, masterPath);

  logger.info(`MASTER_ZIP_CREATED=${path.basename(masterPath)}`);
  return masterPath;
}

/** Recursively delete a directory. */
export function removeDirectoryRecursive(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

/** Clear Chromium/Playwright temp download leftovers under .playwright-downloads/. */
export function cleanPlaywrightDownloadTemp(
  dayOutputFolder: string,
  logger?: Logger,
): void {
  const tempDir = playwrightDownloadsDir(dayOutputFolder);
  if (!fs.existsSync(tempDir)) {
    return;
  }
  try {
    for (const name of fs.readdirSync(tempDir)) {
      const p = path.join(tempDir, name);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.unlinkSync(p);
        }
      } catch {
        // ignore individual failures
      }
    }
    logger?.info(`Cleaned Playwright download temp: ${tempDir}`);
  } catch (error) {
    logger?.warn(
      `Failed cleaning Playwright download temp: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Dedicated Chromium downloadsPath — never the daily tender output root. */
export function playwrightDownloadsDir(dayOutputFolder: string): string {
  return path.join(dayOutputFolder, ".playwright-downloads");
}

/** Remove UUID-looking leftover files accidentally left in the day folder root. */
export function cleanOrphanUuidFilesInDayFolder(
  dayOutputFolder: string,
  logger?: Logger,
): void {
  if (!fs.existsSync(dayOutputFolder)) {
    return;
  }
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const name of fs.readdirSync(dayOutputFolder)) {
    if (!uuidRe.test(name)) {
      continue;
    }
    const p = path.join(dayOutputFolder, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile()) {
        fs.unlinkSync(p);
        logger?.info(`Removed orphan Chromium download file: ${name}`);
      }
    } catch {
      // ignore
    }
  }
}
