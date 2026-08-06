import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTenderMetadata } from "./tenderMetadataStore.js";

export type SourcePortal = "TENDER247" | "BIDASSIST";

function displayLabel(sourcePortal: SourcePortal, sourceTenderId: string): string {
  return `${sourcePortal}-${sourceTenderId}`;
}

/**
 * Fetch raw_metadata from Supabase and write a temporary metadata.json
 * under os.tmpdir(). Never writes into the tender download folder.
 */
export async function materializeTenderMetadata(
  sourcePortal: SourcePortal,
  sourceTenderId: string,
): Promise<{ filePath: string; cleanup: () => void }> {
  const row = await getTenderMetadata(sourcePortal, sourceTenderId);
  if (!row?.raw_metadata) {
    throw new Error(
      `No raw_metadata in Supabase for ${sourcePortal}/${sourceTenderId}`,
    );
  }

  const label = displayLabel(sourcePortal, sourceTenderId);
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `agenttender-meta-${sourcePortal.toLowerCase()}-`),
  );
  const filePath = path.join(tempRoot, "metadata.json");
  fs.writeFileSync(filePath, JSON.stringify(row.raw_metadata, null, 2), "utf8");
  console.log(`CHATGPT_TEMP_METADATA_CREATED=${label}`);

  return {
    filePath,
    cleanup: () => {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        console.log(`CHATGPT_TEMP_METADATA_REMOVED=${label}`);
      } catch {
        // ignore cleanup errors
      }
    },
  };
}
