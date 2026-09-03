/** UTC SAS window — keep in sync with Edge `directUploadSas.ts`. */
export const DIRECT_UPLOAD_SAS_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const DIRECT_UPLOAD_SAS_TTL_MS = 30 * 60 * 1000;

export function computeDirectUploadSasWindow(nowMs = Date.now()): {
  startsOn: Date;
  expiresOn: Date;
  validityDurationMs: number;
} {
  const startsOn = new Date(nowMs - DIRECT_UPLOAD_SAS_CLOCK_SKEW_MS);
  const expiresOn = new Date(nowMs + DIRECT_UPLOAD_SAS_TTL_MS);
  return {
    startsOn,
    expiresOn,
    validityDurationMs: expiresOn.getTime() - startsOn.getTime(),
  };
}
