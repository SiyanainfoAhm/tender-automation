/**
 * Deterministic Azure Block Blob IDs.
 * Azure requires Base64-encoded IDs of equal decoded length.
 * Example decoded label: block-000001
 */
export function azureBlockLabel(chunkIndex: number): string {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error("chunkIndex must be a non-negative integer");
  }
  return `block-${String(chunkIndex + 1).padStart(6, "0")}`;
}

export function encodeAzureBlockId(chunkIndex: number): string {
  const label = azureBlockLabel(chunkIndex);
  if (typeof btoa === "function") {
    return btoa(label);
  }
  return Buffer.from(label, "utf8").toString("base64");
}

export function decodeAzureBlockId(blockId: string): string {
  if (typeof atob === "function") {
    return atob(blockId);
  }
  return Buffer.from(blockId, "base64").toString("utf8");
}
