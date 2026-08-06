import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ensureDir } from "../fileUtils.js";

const execFileAsync = promisify(execFile);

/** Extract a ZIP archive into destDir (Windows-friendly: tar, then Expand-Archive). */
export async function extractZipArchive(
  zipPath: string,
  destDir: string,
): Promise<void> {
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size <= 0) {
    throw new Error(`ZIP missing or empty: ${zipPath}`);
  }
  ensureDir(destDir);

  try {
    await execFileAsync("tar", ["-xf", zipPath, "-C", destDir], {
      windowsHide: true,
    });
    return;
  } catch {
    // fall through to PowerShell
  }

  const ps = `
$ErrorActionPreference = 'Stop'
Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force
`;
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", ps],
    { windowsHide: true },
  );
}

/** Recursively list files under a directory. */
export function listFilesRecursive(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (st.isFile()) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out;
}
