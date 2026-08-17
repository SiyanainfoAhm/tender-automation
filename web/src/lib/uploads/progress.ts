export function uploadPercentage(
  uploadedBytes: number,
  totalBytes: number,
): number {
  if (!Number.isFinite(uploadedBytes) || !Number.isFinite(totalBytes)) return 0;
  if (totalBytes <= 0) return 0;
  const raw = (Math.max(0, uploadedBytes) / totalBytes) * 100;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

export function totalChunksForSize(
  fileSizeBytes: number,
  chunkSize: number,
): number {
  if (fileSizeBytes <= 0 || chunkSize <= 0) return 0;
  return Math.ceil(fileSizeBytes / chunkSize);
}

export function chunkByteRange(
  fileSizeBytes: number,
  chunkSize: number,
  chunkIndex: number,
): { start: number; end: number; size: number } {
  const start = chunkIndex * chunkSize;
  const end = Math.min(fileSizeBytes, start + chunkSize);
  return { start, end, size: Math.max(0, end - start) };
}

export function uploadedBytesFromIndexes(
  fileSizeBytes: number,
  chunkSize: number,
  receivedIndexes: Iterable<number>,
): number {
  let total = 0;
  for (const index of receivedIndexes) {
    total += chunkByteRange(fileSizeBytes, chunkSize, index).size;
  }
  return total;
}

/** Always show one decimal for MB+ so progress copy stays stable. */
export function formatUploadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function formatSizeLimitMb(maxBytes: number): string {
  const mb = maxBytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(1)} MB`;
}
