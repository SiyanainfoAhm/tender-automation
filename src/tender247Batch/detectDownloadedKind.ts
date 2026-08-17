import fs from "node:fs";
import path from "node:path";

export type DetectedArtifactKind = "zip" | "pdf" | "ole" | "html" | "unknown";

export function detectArtifactKind(filePath: string): DetectedArtifactKind {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(8);
      const n = fs.readSync(fd, header, 0, 8, 0);
      if (n < 2) return "unknown";
      if (header[0] === 0x50 && header[1] === 0x4b) return "zip";
      if (n >= 4 && header.subarray(0, 4).toString("ascii") === "%PDF") {
        return "pdf";
      }
      if (
        n >= 4 &&
        header[0] === 0xd0 &&
        header[1] === 0xcf &&
        header[2] === 0x11 &&
        header[3] === 0xe0
      ) {
        return "ole";
      }
      const text = header.subarray(0, n).toString("ascii").toLowerCase();
      if (text.includes("<!doc") || text.includes("<html")) return "html";
      return "unknown";
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "unknown";
  }
}

export function extensionForArtifactKind(
  kind: DetectedArtifactKind,
  fallback: string,
): string {
  if (kind === "zip") return "zip";
  if (kind === "pdf") return "pdf";
  if (kind === "html") return "html";
  return fallback.replace(/^\./, "") || "bin";
}

/**
 * If the file extension does not match content (PDF saved as .zip, etc.),
 * rename in place and return the corrected path.
 */
export function correctArtifactFileExtension(filePath: string): string {
  if (!fs.existsSync(filePath)) return filePath;
  const kind = detectArtifactKind(filePath);
  const currentExt = path.extname(filePath).replace(/^\./, "").toLowerCase();
  const wanted = extensionForArtifactKind(kind, currentExt);
  if (!wanted || wanted === currentExt) return filePath;
  if (kind === "unknown") return filePath;
  const dest = path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}.${wanted}`,
  );
  if (path.resolve(dest) === path.resolve(filePath)) return filePath;
  if (fs.existsSync(dest)) {
    if (fs.statSync(dest).size > 0) {
      fs.unlinkSync(filePath);
      return dest;
    }
    fs.unlinkSync(dest);
  }
  fs.renameSync(filePath, dest);
  return dest;
}
