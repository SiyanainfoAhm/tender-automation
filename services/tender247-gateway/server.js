require("dotenv").config();

const express = require("express");
const axios = require("axios");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");
const { documentLinksLogicalSuccess, manifestEntry, manifestEnvelope, normalizeManifest } = require("./manifest");
const { StageStore, validIdentityKey } = require("./staging");

const TOKEN = /^[A-Za-z0-9_-]{8,512}$/;
const safeToken = (value) => typeof value === "string" && TOKEN.test(value) ? value : null;
const stageIdentity = (request) => validIdentityKey(request.headers["x-tender247-stage-identity"]) ? request.headers["x-tender247-stage-identity"] : null;
const publicStage = (staged) => ({ size: staged.size, contentType: staged.contentType, filename: staged.filename, stagedId: staged.id, expiresAt: new Date(staged.expiresAt).toISOString(), integrityVerification: staged.integrityVerification || null, sha256: staged.sha256 || null });
const auth = (env) => (request, response, next) => !env.GATEWAY_SECRET || request.headers.authorization !== `Bearer ${env.GATEWAY_SECRET}`
  ? response.status(401).json({ error: "Unauthorized" }) : next();
const upstreamHeaders = (env) => ({ accept: "*/*", Authorization: `Bearer ${env.TENDER247_TOKEN}` });
const contentRange = (value) => /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(value || ""));
function parsedContentRange(value) {
  const match = contentRange(value); if (!match) return null;
  const start = Number(match[1]); const end = Number(match[2]); const total = match[3] === "*" ? null : Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || (total !== null && (!Number.isSafeInteger(total) || total <= end))) return null;
  return { start, end, total };
}
function positiveSafeInteger(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }
// Digest is independently verifiable after EOF; ETag is deliberately not used
// because it is not reliably a content hash across proxies/providers.
function sha256Digest(headers) {
  const raw = String(headers?.digest ?? headers?.["content-digest"] ?? "");
  const match = /sha-256\s*=\s*(?::([A-Za-z0-9+/]{43}=):|([A-Za-z0-9+/]{43}=))/i.exec(raw);
  return match?.[1] || match?.[2] || null;
}
function sourceSizeEvidence(headers) {
  const range = parsedContentRange(headers?.["content-range"]);
  return { contentLength: positiveSafeInteger(headers?.["content-length"]), contentRangeTotal: range?.total ?? null, transferEncoding: String(headers?.["transfer-encoding"] || "").toLowerCase() || null, sha256Digest: Boolean(sha256Digest(headers)) };
}
function safeDownloadDiagnostics(result, staged, attempt, stageReused) {
  const headers = result?.headers || {};
  const rawContentLength = Number(headers["content-length"]);
  return {
    attempt: attempt + 1, upstreamStatus: Number.isInteger(result?.status) ? result.status : null,
    responseHeaders: {
      contentType: String(headers["content-type"] || "") || null,
      // Zero is diagnostic evidence here (unlike an expected source size,
      // where it is never a valid completed document).
      contentLength: Number.isSafeInteger(rawContentLength) && rawContentLength >= 0 ? rawContentLength : null,
      contentRange: parsedContentRange(headers["content-range"]),
      transferEncoding: String(headers["transfer-encoding"] || "").toLowerCase() || null,
      acceptRanges: String(headers["accept-ranges"] || "").toLowerCase() || null,
      hasSha256Digest: Boolean(sha256Digest(headers)),
    },
    bytesReceived: staged?.bytesWritten ?? 0, stageReused: Boolean(stageReused),
    streamComplete: typeof result?.data?.complete === "boolean" ? result.data.complete : null,
    streamAborted: result?.data?.aborted === true,
  };
}
// Tender247 applies limits per credential, not per HTTP client.  This must be
// shared by every route in this process; Express' per-client limiter alone
// cannot protect the upstream service.
const RETRY_ATTEMPTS = 3;
const DEFAULT_UPSTREAM_CONCURRENCY = 2;
const DEFAULT_UPSTREAM_MIN_INTERVAL_MS = 350;
const DEFAULT_UPSTREAM_QUEUE_LIMIT = 200;
const DEFAULT_CIRCUIT_FAILURES = 3;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 30_000;
const isTransientUpstreamError = (error) => {
  const status = error?.response?.status;
  return !status || status === 408 || status === 425 || status === 429 || status >= 500;
};
function retryAfterMs(headers) {
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120_000, Math.ceil(seconds * 1000));
  const date = Date.parse(String(raw));
  return Number.isFinite(date) ? Math.min(120_000, Math.max(0, date - Date.now())) : null;
}
const retryDelayMs = (attempt, headers) => retryAfterMs(headers) ?? Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 300);

class UpstreamLimiter {
  constructor({ concurrency = DEFAULT_UPSTREAM_CONCURRENCY, minIntervalMs = DEFAULT_UPSTREAM_MIN_INTERVAL_MS, queueLimit = DEFAULT_UPSTREAM_QUEUE_LIMIT, circuitFailures = DEFAULT_CIRCUIT_FAILURES, circuitCooldownMs = DEFAULT_CIRCUIT_COOLDOWN_MS } = {}) {
    this.concurrency = Math.max(1, concurrency); this.minIntervalMs = Math.max(0, minIntervalMs); this.queueLimit = Math.max(1, queueLimit);
    this.circuitFailures = Math.max(1, circuitFailures); this.circuitCooldownMs = Math.max(1, circuitCooldownMs);
    this.active = 0; this.queue = []; this.nextStartAt = 0; this.pauseUntil = 0; this.consecutiveFailures = 0; this.circuitOpenUntil = 0; this.timer = null;
  }
  run(operation) {
    if (Date.now() < this.circuitOpenUntil) return Promise.reject(Object.assign(new Error("UPSTREAM_CIRCUIT_OPEN"), { code: "UPSTREAM_CIRCUIT_OPEN", retryAfterMs: this.circuitOpenUntil - Date.now() }));
    if (this.queue.length >= this.queueLimit) return Promise.reject(Object.assign(new Error("UPSTREAM_QUEUE_FULL"), { code: "UPSTREAM_QUEUE_FULL" }));
    return new Promise((resolve, reject) => { this.queue.push({ operation, resolve, reject }); this.drain(); });
  }
  defer(ms) { this.pauseUntil = Math.max(this.pauseUntil, Date.now() + Math.max(0, ms || 0)); this.drain(); }
  noteSuccess() { this.consecutiveFailures = 0; }
  noteFailure(error) {
    if (error?.response?.status === 429) this.defer(retryAfterMs(error.response.headers) ?? 5_000);
    if (isTransientUpstreamError(error) && ++this.consecutiveFailures >= this.circuitFailures) this.circuitOpenUntil = Date.now() + this.circuitCooldownMs;
  }
  drain() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.active >= this.concurrency || !this.queue.length) return;
    // Calls queued before a transient-failure threshold was reached must not
    // slip through after the circuit opens. Reject them with the same bounded
    // retry hint as new calls; otherwise a large queue defeats the breaker.
    if (Date.now() < this.circuitOpenUntil) {
      const retryAfterMs = this.circuitOpenUntil - Date.now();
      const error = () => Object.assign(new Error("UPSTREAM_CIRCUIT_OPEN"), { code: "UPSTREAM_CIRCUIT_OPEN", retryAfterMs });
      while (this.queue.length) this.queue.shift().reject(error());
      return;
    }
    const wait = Math.max(0, this.pauseUntil - Date.now(), this.nextStartAt - Date.now());
    if (wait) { this.timer = setTimeout(() => this.drain(), wait); return; }
    const item = this.queue.shift(); this.active += 1; this.nextStartAt = Date.now() + this.minIntervalMs;
    Promise.resolve().then(item.operation).then((value) => { this.noteSuccess(); item.resolve(value); }, (error) => { this.noteFailure(error); item.reject(error); }).finally(() => { this.active -= 1; this.drain(); });
    this.drain();
  }
}
async function retryUpstream(operation, limiter, { attempts = RETRY_ATTEMPTS } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await limiter.run(operation); }
    catch (error) {
      lastError = error;
      if (!isTransientUpstreamError(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, error.response?.headers)));
    }
  }
  throw lastError;
}
function expectedSourceSize(headers, status, offset, providerDeclaredSize = null) {
  const range = parsedContentRange(headers?.["content-range"]);
  const declared = positiveSafeInteger(providerDeclaredSize);
  const fromRange = range?.total ?? null;
  const length = positiveSafeInteger(headers?.["content-length"]);
  const fromLength = range ? (length !== null && length !== range.end - range.start + 1 ? null : fromRange) : (length === null ? null : offset + length);
  if ((range && length !== null && fromLength === null) || (declared !== null && ((fromRange !== null && declared !== fromRange) || (fromLength !== null && declared !== fromLength)))) return null;
  return fromRange ?? fromLength ?? declared;
}

function sanitizedMessage(value) {
  if (typeof value !== "string") return null;
  return value.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/(token(?:=|:|\s+))[A-Za-z0-9_-]{8,512}/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s,;]+/gi, "[URL_REDACTED]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[REDACTED]").slice(0, 240);
}

function manifestDiagnostics({ upstreamStatus = null, payload = null, normalizedCount = 0, error = null } = {}) {
  const envelope = manifestEnvelope(payload);
  return {
    upstreamStatus, logicalSuccess: envelope.success, logicalStatus: envelope.statusCode,
    message: sanitizedMessage(envelope.message), hasData: envelope.hasData,
    sourceCount: envelope.sourceCount, normalizedCount,
    errorCode: sanitizedMessage(error?.code), errorMessage: sanitizedMessage(error?.message),
  };
}

function failed(response, error, context = {}) {
  const diagnostic = manifestDiagnostics({ upstreamStatus: error.response?.status || null, payload: error.response?.data, error });
  const classification = error.code === "UPSTREAM_CIRCUIT_OPEN" ? "UPSTREAM_CIRCUIT_OPEN" : error.code === "UPSTREAM_QUEUE_FULL" ? "UPSTREAM_QUEUE_FULL" : error.code || (diagnostic.upstreamStatus === 429 ? "UPSTREAM_RATE_LIMITED" : diagnostic.upstreamStatus >= 500 ? "UPSTREAM_5XX" : "UPSTREAM_REQUEST_FAILED");
  const retryMs = error.retryAfterMs ?? retryAfterMs(error.response?.headers);
  const safeContext = {
    timestamp: new Date().toISOString(), requestCorrelationId: context.requestCorrelationId || null,
    operationStage: context.operationStage || "unknown", documentIdentityHash: context.documentIdentityHash || null,
    retryClassification: isTransientUpstreamError(error) ? "TRANSIENT" : "NON_RETRYABLE",
  };
  console.error("[tender247-gateway] upstream request failed", { ...safeContext, ...diagnostic, classification, ...(error.downloadDiagnostics ? { downloadDiagnostics: error.downloadDiagnostics } : {}), ...(error.code === "SOURCE_SIZE_UNKNOWN" ? { sourceSizeEvidence: error.sourceSizeEvidence || null } : {}) });
  if (retryMs) response.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryMs / 1000))));
  return response.status(error.code === "UPSTREAM_CIRCUIT_OPEN" || error.code === "UPSTREAM_QUEUE_FULL" ? 503 : diagnostic.upstreamStatus || 502).json({
    error: "Tender247 request failed", upstreamStatus: diagnostic.upstreamStatus,
    logicalSuccess: diagnostic.logicalSuccess, logicalStatus: diagnostic.logicalStatus,
    message: diagnostic.message, classification, retryAfterMs: retryMs || null,
    ...(context.requestCorrelationId ? { requestCorrelationId: safeContext.requestCorrelationId, operationStage: safeContext.operationStage } : {}),
    ...(error.downloadDiagnostics ? { downloadDiagnostics: error.downloadDiagnostics } : {}),
    ...(error.code === "SOURCE_SIZE_UNKNOWN" ? { sourceSizeEvidence: error.sourceSizeEvidence || null } : {}),
  });
}

function createGateway({ axiosClient = axios, env = process.env, upstreamLimiter = new UpstreamLimiter({
  concurrency: Number(env.TENDER247_UPSTREAM_CONCURRENCY) || DEFAULT_UPSTREAM_CONCURRENCY,
  minIntervalMs: Number(env.TENDER247_UPSTREAM_MIN_INTERVAL_MS) || DEFAULT_UPSTREAM_MIN_INTERVAL_MS,
  queueLimit: Number(env.TENDER247_UPSTREAM_QUEUE_LIMIT) || DEFAULT_UPSTREAM_QUEUE_LIMIT,
}), stageStore = new StageStore({
  directory: env.TENDER247_STAGE_DIR,
  maxBytes: Number(env.TENDER247_STAGE_MAX_BYTES) || 50 * 1024 * 1024,
  quotaBytes: Number(env.TENDER247_STAGE_QUOTA_BYTES) || 500 * 1024 * 1024,
  ttlMs: Number(env.TENDER247_STAGE_TTL_MS) || 60 * 60 * 1000,
}) } = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet()); app.use(rateLimit({ windowMs: 60000, max: 120 }));
  app.get("/health", (_request, response) => response.json({ status: "ok", service: "tender247-gateway" }));
  app.get("/api/tender247/tenders", auth(env), async (request, response) => {
    // `scrapedDate` is an application processing label, not a Tender247
    // parameter.  Until Tender247 documents filtering/pagination, retain the
    // observed no-query feed behaviour and let the application report source
    // completeness as UNVERIFIED.  Never guess or forward provider params.
    const mode = String(env.TENDER247_UPSTREAM_CONTRACT_STATUS || "").trim();
    if (mode !== "COMPATIBILITY_UNVERIFIED" && mode !== "VERIFIED") return response.status(503).json({ error: "Tender247 synchronization requires explicit COMPATIBILITY_UNVERIFIED or VERIFIED mode." });
    if (Object.keys(request.query).length) return response.status(400).json({ error: "Tender247 tender feed does not accept query parameters." });
    try {
      const result = await retryUpstream(() => axiosClient.get(`${env.TENDER247_BASE_URL}/tender-data`, { headers: upstreamHeaders(env), timeout: 60000 }), upstreamLimiter);
      response.status(result.status).json(result.data);
    } catch (error) { failed(response, error); }
  });
  app.get("/api/tender247/document-links/:token", auth(env), async (request, response) => {
    const token = safeToken(request.params.token);
    if (!token) return response.status(400).json({ error: "Invalid document token" });
    try {
      const result = await retryUpstream(() => axiosClient.get(`${env.TENDER247_BASE_URL}/partner-document-download-links/${token}`, { headers: upstreamHeaders(env), timeout: 60000 }), upstreamLimiter);
      const envelope = manifestEnvelope(result.data);
      // A missing optional Success/status flag is not itself a failure. The
      // documented Data/data manifest array below is still mandatory and is
      // strictly normalized before a response can be successful.
      if (documentLinksLogicalSuccess(result.data) === false) {
        const diagnostic = manifestDiagnostics({ upstreamStatus: result.status, payload: result.data });
        console.error("[tender247-gateway] Tender247 logical failure", diagnostic);
        return response.status(502).json({ error: "Tender247 logical failure", message: diagnostic.message });
      }
      let data;
      try { data = normalizeManifest(result.data); }
      catch (error) {
        const diagnostic = manifestDiagnostics({ upstreamStatus: result.status, payload: result.data, error });
        console.error("[tender247-gateway] manifest normalization failed", diagnostic);
        return response.status(502).json({ error: "Tender247 manifest normalization failed" });
      }
      const diagnostic = manifestDiagnostics({ upstreamStatus: result.status, payload: result.data, normalizedCount: data.length });
      console.info("[tender247-gateway] manifest success", diagnostic);
      return response.status(result.status).json({ status: result.data?.Status || result.data?.status || "success", count: data.length, data });
    } catch (error) {
      return failed(response, error);
    }
  });
  app.get("/api/tender247/document/:token", auth(env), async (request, response) => {
    const token = safeToken(request.params.token);
    if (!token) return response.status(400).json({ error: "Invalid document token" });
    const range = typeof request.headers.range === "string" && /^bytes=\d+-$/.test(request.headers.range) ? request.headers.range : undefined;
    try {
      const result = await retryUpstream(() => axiosClient.get(`${env.TENDER247_BASE_URL}/partner-single-document-download/${token}`, { headers: { ...upstreamHeaders(env), ...(range ? { Range: range } : {}) }, timeout: 120000, responseType: "stream", validateStatus: (status) => status === 200 || status === 206 }), upstreamLimiter);
      response.status(result.status);
      for (const header of ["content-type", "content-disposition", "content-length", "content-range", "accept-ranges"]) if (result.headers?.[header]) response.setHeader(header, result.headers[header]);
      const abort = () => { if (!response.writableEnded) result.data.destroy(); };
      request.on("aborted", abort); response.on("close", abort);
      result.data.on("error", () => response.destroy()); result.data.pipe(response);
    } catch (error) { failed(response, error); }
  });
  app.get("/api/tender247/document-info/:token", auth(env), async (request, response) => {
    const token = safeToken(request.params.token);
    if (!token) return response.status(400).json({ error: "Invalid document token" });
    const identityKey = stageIdentity(request);
    if (!identityKey) return response.status(400).json({ error: "Invalid stage identity" });
    const requestCorrelationId = crypto.randomUUID(); let operationStage = "stage_lookup";
    return stageStore.withIdentityLock(identityKey, async () => {
    try {
      let staged = await stageStore.find(identityKey);
      if (staged?.sourceDownloadComplete) return response.status(200).json(publicStage(staged));
      let restartedFromZero = false;
      // A stage file is durable before the first source read. Each retry starts
      // precisely at bytesWritten; this makes PM2/process restarts safe too.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const offset = staged?.bytesWritten || 0;
        const providerDeclaredSize = positiveSafeInteger(request.headers["x-tender247-expected-size"]);
        operationStage = "upstream_download";
        const result = await retryUpstream(() => axiosClient.get(`${env.TENDER247_BASE_URL}/partner-single-document-download/${token}`, {
          headers: { ...upstreamHeaders(env), ...(offset ? { Range: `bytes=${offset}-` } : {}) }, timeout: 120000, responseType: "stream", validateStatus: (status) => status === 200 || status === 206,
        }), upstreamLimiter, { attempts: 1 });
        if (result.status !== 200 && result.status !== 206) {
          result.data?.destroy?.();
          throw Object.assign(new Error(`SOURCE_STATUS_INVALID: HTTP ${result.status}`), { code: "SOURCE_STATUS_INVALID" });
        }
        if (offset && result.status !== 206) {
          result.data.destroy();
          // Tender247 sometimes ignores Range. Never append that HTTP 200
          // body to a partial stage: discard only the incomplete file and
          // retry once from byte zero in this bounded request.
          if (!restartedFromZero && await stageStore.discard(staged)) { staged = null; restartedFromZero = true; continue; }
          throw Object.assign(new Error("SOURCE_RESUME_FAILED: upstream ignored Range request"), { code: "SOURCE_RESUME_FAILED" });
        }
        const range = parsedContentRange(result.headers?.["content-range"]);
        if (result.status === 206 && (!range || range.start !== offset)) {
          result.data.destroy();
          if (!restartedFromZero && await stageStore.discard(staged)) { staged = null; restartedFromZero = true; continue; }
          throw Object.assign(new Error("SOURCE_RESUME_FAILED: invalid Content-Range"), { code: "SOURCE_RESUME_FAILED" });
        }
        const disposition = String(result.headers?.["content-disposition"] || "");
        const filename = /filename\*?=(?:UTF-8''|\")?([^;\"]+)/i.exec(disposition)?.[1] || staged?.filename || "tender247-document";
        const expected = expectedSourceSize(result.headers, result.status, offset, providerDeclaredSize);
        const digest = sha256Digest(result.headers);
        const stageReused = Boolean(staged);
        staged = staged || await stageStore.begin({ contentType: result.headers?.["content-type"], filename, identityKey, expectedSize: expected, expectedDigest: digest });
        if (expected !== null && staged.expectedSize !== null && staged.expectedSize !== expected) {
          result.data.destroy();
          if (offset && !restartedFromZero && await stageStore.discard(staged)) { staged = null; restartedFromZero = true; continue; }
          throw Object.assign(new Error("SOURCE_RESUME_FAILED: source total changed"), { code: "SOURCE_RESUME_FAILED" });
        }
        if (expected !== null && staged.expectedSize === null) { staged.expectedSize = expected; await stageStore.persist(staged); }
        if (digest && staged.expectedDigest && digest !== staged.expectedDigest) {
          result.data.destroy();
          if (offset && !restartedFromZero && await stageStore.discard(staged)) { staged = null; restartedFromZero = true; continue; }
          throw Object.assign(new Error("SOURCE_DIGEST_CHANGED"), { code: "SOURCE_DIGEST_CHANGED" });
        }
        if (digest && !staged.expectedDigest) { staged.expectedDigest = digest; await stageStore.persist(staged); }
        operationStage = "stage_append";
        try { await stageStore.append(staged, result.data); }
        catch (error) { if (attempt === 2) throw Object.assign(error, { code: error.code || "SOURCE_STREAM_INTERRUPTED" }); await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt))); continue; }
        if (staged.expectedSize === null || staged.bytesWritten === staged.expectedSize) {
          operationStage = "stage_integrity_validation";
          try { return response.status(200).json(publicStage(await stageStore.complete(staged, { transportVerified: true, stream: result.data }))); }
          catch (error) {
            // Only a clean but empty body is retried. PDF/ZIP/digest failures
            // are permanent evidence failures and must remain blocked.
            if (error?.code !== "DOCUMENT_STAGE_EMPTY") throw error;
            error.downloadDiagnostics = safeDownloadDiagnostics(result, staged, attempt, stageReused);
            const discarded = await stageStore.discard(staged);
            error.downloadDiagnostics.zeroByteStageDiscarded = discarded;
            staged = null; restartedFromZero = false;
            if (attempt === 2) throw error;
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
            continue;
          }
        }
      }
      throw Object.assign(new Error("SOURCE_STREAM_INTERRUPTED"), { code: "SOURCE_STREAM_INTERRUPTED" });
    } catch (error) { return failed(response, error, { requestCorrelationId, operationStage, documentIdentityHash: identityKey }); }
    });
  });
  app.get("/api/tender247/staged-document/:stagedId/info", auth(env), async (request, response) => {
    const identityKey = stageIdentity(request);
    if (!identityKey) return response.status(400).json({ error: "Invalid stage identity" });
    const staged = await stageStore.get(request.params.stagedId, identityKey);
    if (!staged) return response.status(404).json({ error: "Staged document not found" });
    return response.status(200).json(publicStage(staged));
  });
  app.get("/api/tender247/staged-document/:stagedId", auth(env), async (request, response) => {
    const identityKey = stageIdentity(request);
    if (!identityKey) return response.status(400).json({ error: "Invalid stage identity" });
    const staged = await stageStore.get(request.params.stagedId, identityKey);
    if (!staged) return response.status(404).json({ error: "Staged document not found" });
    const match = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range || ""));
    const start = match ? Number(match[1]) : 0; const end = match && match[2] ? Number(match[2]) : staged.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= staged.size) return response.status(416).end();
    response.status(match ? 206 : 200).set({ "content-type": staged.contentType, "content-length": String(end - start + 1), "accept-ranges": "bytes", "content-disposition": `attachment; filename="${staged.filename}"` });
    if (match) response.set("content-range", `bytes ${start}-${end}/${staged.size}`);
    return require("node:fs").createReadStream(staged.path, { start, end }).pipe(response);
  });
  app.delete("/api/tender247/staged-document/:stagedId", auth(env), async (request, response) => {
    const identityKey = stageIdentity(request);
    if (!identityKey) return response.status(400).json({ error: "Invalid stage identity" });
    await stageStore.remove(request.params.stagedId, identityKey); return response.status(204).end();
  });
  return app;
}

if (require.main === module) createGateway().listen(process.env.PORT || 3000, "127.0.0.1", () => console.log(`Tender247 gateway running on port ${process.env.PORT || 3000}`));

module.exports = { createGateway, StageStore, UpstreamLimiter, safeToken, documentLinksLogicalSuccess, manifestEntry, manifestEnvelope, normalizeManifest, sanitizedMessage, retryAfterMs, retryUpstream, expectedSourceSize, parsedContentRange, sha256Digest, sourceSizeEvidence, safeDownloadDiagnostics };
