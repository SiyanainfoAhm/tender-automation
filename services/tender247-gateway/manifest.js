const TOKEN = /^[A-Za-z0-9_-]{8,512}$/;

const safeToken = (value) => typeof value === "string" && TOKEN.test(value) ? value : null;

function manifestEntry(item) {
  let token = safeToken(item?.token || item?.downloadToken);
  const link = item?.link || item?.downloadLink;
  if (!token && typeof link === "string") {
    try {
      const url = new URL(link);
      const parts = url.pathname.split("/").filter(Boolean);
      if (url.protocol !== "https:" || url.hostname !== "partnersdataapi.tender247.com" || url.search || url.hash
        || parts.length !== 4 || parts.slice(0, 3).join("/") !== "T247Data/api/partner-single-document-download") return null;
      token = safeToken(parts[3]);
    } catch { return null; }
  }
  const documentid = item?.documentid ?? item?.documentId ?? item?.id ?? token;
  const filename = String(item?.filename ?? item?.fileName ?? item?.name ?? "").trim();
  const contentType = String(item?.contentType ?? item?.content_type ?? item?.type ?? "application/octet-stream");
  const sizeValue = item?.size ?? item?.fileSize ?? item?.filesize;
  const size = sizeValue == null ? null : Number(sizeValue);
  return token && documentid != null && filename
    ? { documentid: String(documentid), filename, contentType, size: Number.isSafeInteger(size) && size > 0 ? size : null, token }
    : null;
}

function manifestEnvelope(payload) {
  const source = Array.isArray(payload?.Data) ? payload.Data : Array.isArray(payload?.data) ? payload.data : null;
  return {
    success: payload?.Success ?? payload?.success ?? null,
    status: typeof payload?.status === "string" ? payload.status.toLowerCase() : null,
    statusCode: payload?.StatusCode ?? payload?.statusCode ?? null,
    message: typeof (payload?.Message ?? payload?.message) === "string" ? payload.Message ?? payload.message : null,
    hasData: source !== null,
    source,
    sourceCount: source?.length ?? 0,
  };
}

function documentLinksLogicalSuccess(payload) {
  const envelope = manifestEnvelope(payload);
  if (envelope.status === "success") return true;
  if (envelope.status === "failed" || envelope.status === "error") return false;
  if (envelope.success === true) return true;
  if (envelope.success === false) return false;
  // Some Tender247 variants omit Success/status but retain StatusCode. Treat
  // an explicit client/server failure as a logical failure; a 2xx code alone
  // does not prove success, so structural manifest validation still decides.
  const code = Number(envelope.statusCode);
  if (Number.isSafeInteger(code) && code >= 400) return false;
  return null;
}

function normalizeManifest(payload) {
  const envelope = manifestEnvelope(payload);
  if (!envelope.source) throw new Error("Tender247 manifest response has no Data array");
  const data = envelope.source.map(manifestEntry).filter(Boolean);
  if (envelope.source.length && !data.length) throw new Error("Tender247 manifest response contains no valid documents");
  return data;
}

module.exports = { documentLinksLogicalSuccess, manifestEntry, manifestEnvelope, normalizeManifest };
