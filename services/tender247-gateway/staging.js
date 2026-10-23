const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const safeFilename = (value) => {
  const raw = String(value || "").split(/[\\/]+/).pop().replace(/[\x00-\x1f<>:"|?*]/g, "_").replace(/\.\.+/g, ".").trim().replace(/[. ]+$/g, "");
  const dot = raw.lastIndexOf("."); const ext = dot > 0 ? raw.slice(dot).replace(/[^A-Za-z0-9.]/g, "") : "";
  const base = (dot > 0 ? raw.slice(0, dot) : raw).replace(/^\.+/, "").slice(0, Math.max(1, 180 - ext.length));
  return `${base || "tender247-document"}${ext}` || "tender247-document";
};
const validId = (id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);
const validIdentityKey = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readFileBuffer(file) { return fsp.readFile(file); }

// A deliberately small format gate. It catches the common failure mode (an
// HTML error page or a truncated binary) without pretending to be a full PDF
// parser. The transport checks below remain the primary completeness evidence.
function validatePdf(buffer) {
  if (buffer.length < 8 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw Object.assign(new Error("DOCUMENT_PDF_SIGNATURE_INVALID"), { code: "DOCUMENT_PDF_SIGNATURE_INVALID" });
  const tail = buffer.subarray(Math.max(0, buffer.length - 4096)).toString("latin1");
  if (!/%%EOF(?:[\0\t\n\r\f ]*)$/.test(tail)) throw Object.assign(new Error("DOCUMENT_PDF_EOF_INVALID"), { code: "DOCUMENT_PDF_EOF_INVALID" });
}

function validateZip(buffer) {
  // EOCD must be in the final 65,557 bytes (the ZIP maximum comment length).
  const searchStart = Math.max(0, buffer.length - 0x10016);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= searchStart; i -= 1) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0 || eocd + 22 > buffer.length) throw Object.assign(new Error("DOCUMENT_ZIP_EOCD_INVALID"), { code: "DOCUMENT_ZIP_EOCD_INVALID" });
  const entries = buffer.readUInt16LE(eocd + 10); const centralSize = buffer.readUInt32LE(eocd + 12); const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > eocd) throw Object.assign(new Error("DOCUMENT_ZIP_DIRECTORY_INVALID"), { code: "DOCUMENT_ZIP_DIRECTORY_INVALID" });
  let cursor = centralOffset;
  for (let entry = 0; entry < entries; entry += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw Object.assign(new Error("DOCUMENT_ZIP_DIRECTORY_INVALID"), { code: "DOCUMENT_ZIP_DIRECTORY_INVALID" });
    const method = buffer.readUInt16LE(cursor + 10); const expectedCrc = buffer.readUInt32LE(cursor + 16); const compressedSize = buffer.readUInt32LE(cursor + 20); const nameLength = buffer.readUInt16LE(cursor + 28); const extraLength = buffer.readUInt16LE(cursor + 30); const commentLength = buffer.readUInt16LE(cursor + 32); const localOffset = buffer.readUInt32LE(cursor + 42);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw Object.assign(new Error("DOCUMENT_ZIP_LOCAL_INVALID"), { code: "DOCUMENT_ZIP_LOCAL_INVALID" });
    const localName = buffer.readUInt16LE(localOffset + 26); const localExtra = buffer.readUInt16LE(localOffset + 28); const dataStart = localOffset + 30 + localName + localExtra;
    if (dataStart + compressedSize > buffer.length) throw Object.assign(new Error("DOCUMENT_ZIP_TRUNCATED"), { code: "DOCUMENT_ZIP_TRUNCATED" });
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let plain;
    try { plain = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null; }
    catch { throw Object.assign(new Error("DOCUMENT_ZIP_DEFLATE_INVALID"), { code: "DOCUMENT_ZIP_DEFLATE_INVALID" }); }
    // Unsupported encrypted/compression methods are not accepted without an
    // authoritative provider length/digest; we cannot validate their CRC.
    if (!plain || crc32(plain) !== expectedCrc) throw Object.assign(new Error("DOCUMENT_ZIP_CRC_INVALID"), { code: "DOCUMENT_ZIP_CRC_INVALID" });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor > centralOffset + centralSize) throw Object.assign(new Error("DOCUMENT_ZIP_DIRECTORY_INVALID"), { code: "DOCUMENT_ZIP_DIRECTORY_INVALID" });
}

async function validateStructure(item) {
  const type = String(item.contentType || "").toLowerCase(); const name = String(item.filename || "").toLowerCase();
  const buffer = await readFileBuffer(item.path);
  if (type.includes("pdf") || name.endsWith(".pdf")) return validatePdf(buffer);
  if (type.includes("zip") || /\.(zip|docx|xlsx|pptx|odt|ods|odp)$/.test(name)) return validateZip(buffer);
  // Unknown formats are accepted only after a clean transport completion,
  // bounded staging and local SHA-256 calculation. No claim of provider-level
  // completeness is made for them.
}

class StageStore {
  constructor({ directory = path.join(os.tmpdir(), "tender247-gateway"), maxBytes = 50 * 1024 * 1024, quotaBytes = 500 * 1024 * 1024, ttlMs = 60 * 60 * 1000 } = {}) {
    this.directory = directory; this.maxBytes = maxBytes; this.quotaBytes = quotaBytes; this.ttlMs = ttlMs; this.items = new Map(); this.identityLocks = new Map();
  }
  metaPath(id) { return path.join(this.directory, `${id}.json`); }
  async load(id) {
    if (!validId(id)) return null;
    const cached = this.items.get(id);
    if (cached) return cached;
    try {
      const item = JSON.parse(await fsp.readFile(this.metaPath(id), "utf8"));
      if (!item || item.id !== id || !validIdentityKey(item.identityKey) || !Number.isSafeInteger(item.bytesWritten) || item.bytesWritten < 0 || typeof item.expiresAt !== "number" || !path.basename(item.path).startsWith(`${id}.`)) return null;
      const stat = await fsp.stat(item.path); if (stat.size !== item.bytesWritten) return null;
      item.size = item.sourceDownloadComplete ? item.bytesWritten : null; this.items.set(id, item); return item;
    } catch { return null; }
  }
  async deleteItem(id, item = this.items.get(id)) {
    this.items.delete(id);
    await Promise.all([item?.path && fsp.unlink(item.path), fsp.unlink(this.metaPath(id))].filter(Boolean).map((promise) => promise.catch(() => undefined)));
  }
  async cleanup(now = Date.now()) {
    await fsp.mkdir(this.directory, { recursive: true });
    for (const entry of await fsp.readdir(this.directory)) {
      if (!entry.endsWith(".json")) continue;
      const id = entry.slice(0, -5); const item = await this.load(id);
      if (!item || item.expiresAt <= now) await this.deleteItem(id, item);
    }
    for (const [id, item] of this.items) if (item.expiresAt <= now) await this.deleteItem(id, item);
  }
  usedBytes() { return [...this.items.values()].reduce((sum, item) => sum + item.bytesWritten, 0); }
  async find(identityKey) {
    await fsp.mkdir(this.directory, { recursive: true });
    for (const entry of await fsp.readdir(this.directory)) {
      if (!entry.endsWith(".json")) continue;
      const item = await this.load(entry.slice(0, -5));
      if (item?.identityKey === identityKey && item.expiresAt > Date.now()) return item;
    }
    return null;
  }
  // The Azure gateway is intentionally one PM2 process. Serialize mutations
  // for one document identity so a cleanup/restart cannot delete a file while
  // another request is appending to it. Different documents remain concurrent.
  async withIdentityLock(identityKey, operation) {
    const previous = this.identityLocks.get(identityKey) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.identityLocks.set(identityKey, tail);
    await previous;
    try { return await operation(); }
    finally { release(); if (this.identityLocks.get(identityKey) === tail) this.identityLocks.delete(identityKey); }
  }
  async persist(item) {
    const target = this.metaPath(item.id); const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(item), "utf8"); await fsp.rename(temporary, target); this.items.set(item.id, item);
  }
  async begin({ contentType, filename, identityKey, expectedSize = null, expectedDigest = null }) {
    if (!validIdentityKey(identityKey)) throw new Error("DOCUMENT_STAGE_IDENTITY_INVALID");
    await this.cleanup(); const prior = await this.find(identityKey); if (prior) return prior;
    expectedDigest = typeof expectedDigest === "string" && /^[A-Za-z0-9+/]{43}=$/.test(expectedDigest) ? expectedDigest : null;
    const id = crypto.randomUUID(); const item = { id, path: path.join(this.directory, `${id}.part`), bytesWritten: 0, expectedSize: Number.isSafeInteger(expectedSize) && expectedSize > 0 ? expectedSize : null, expectedDigest, contentType: String(contentType || "application/octet-stream"), filename: safeFilename(filename), identityKey, expiresAt: Date.now() + this.ttlMs, sourceDownloadComplete: false };
    await fsp.writeFile(item.path, new Uint8Array(), { flag: "wx" }); await this.persist(item); return item;
  }
  async append(item, stream) {
    const output = fs.createWriteStream(item.path, { flags: "a" }); let added = 0;
    try {
      for await (const rawChunk of stream) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        const next = item.bytesWritten + chunk.length;
        if (next > this.maxBytes || this.usedBytes() - item.bytesWritten + next > this.quotaBytes || (item.expectedSize && next > item.expectedSize)) throw new Error("DOCUMENT_STAGE_LIMIT_EXCEEDED");
        // The callback fires only after this chunk reached the stream. Persist
        // the matching byte count before accepting another source chunk.
        await new Promise((resolve, reject) => output.write(chunk, (error) => error ? reject(error) : resolve()));
        item.bytesWritten = next; added += chunk.length; item.expiresAt = Date.now() + this.ttlMs;
        await this.persist(item);
      }
      await new Promise((resolve, reject) => { output.end(resolve); output.once("error", reject); });
      return added;
    } catch (error) { output.destroy(); throw error; }
  }
  async complete(item, { transportVerified = false, stream = null } = {}) {
    if (item.expectedSize !== null && item.bytesWritten !== item.expectedSize) throw Object.assign(new Error(`SOURCE_STREAM_INTERRUPTED (${item.bytesWritten}/${item.expectedSize})`), { code: "SOURCE_STREAM_INTERRUPTED" });
    if (!item.bytesWritten) throw Object.assign(new Error("DOCUMENT_STAGE_EMPTY"), { code: "DOCUMENT_STAGE_EMPTY" });
    if (stream && (stream.aborted === true || stream.complete === false)) throw Object.assign(new Error("SOURCE_STREAM_INTERRUPTED"), { code: "SOURCE_STREAM_INTERRUPTED" });
    if (!transportVerified && item.expectedSize === null && !item.expectedDigest) throw Object.assign(new Error("SOURCE_TRANSPORT_UNVERIFIED"), { code: "SOURCE_TRANSPORT_UNVERIFIED" });
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(item.path)) hash.update(chunk);
    const sha256 = hash.digest("base64");
    if (item.expectedDigest && sha256 !== item.expectedDigest) throw Object.assign(new Error("SOURCE_DIGEST_MISMATCH"), { code: "SOURCE_DIGEST_MISMATCH" });
    await validateStructure(item);
    item.integrityVerification = item.expectedSize !== null || item.expectedDigest ? "PROVIDER_VERIFIED" : "TRANSPORT_VERIFIED";
    item.sha256 = sha256; item.expectedSize = item.bytesWritten; item.sourceDownloadComplete = true; item.size = item.bytesWritten; item.expiresAt = Date.now() + this.ttlMs; await this.persist(item); return item;
  }
  // Only incomplete stages may be discarded for a clean source restart. This
  // deliberately cannot remove a completed stage exposed to the Edge worker.
  async discard(item) { if (!item || item.sourceDownloadComplete) return false; await this.deleteItem(item.id, item); return true; }
  async stage(stream, options) { const item = await this.begin(options); await this.append(item, stream); return this.complete(item); }
  async get(id, identityKey) {
    await this.cleanup(); const item = await this.load(id);
    if (!item || item.expiresAt <= Date.now() || (identityKey && item.identityKey !== identityKey) || !item.sourceDownloadComplete) return null;
    return item;
  }
  async remove(id, identityKey) { const item = await this.get(id, identityKey); if (item) await this.deleteItem(id, item); return Boolean(item); }
}

module.exports = { StageStore, safeFilename, validIdentityKey, validatePdf, validateZip };
