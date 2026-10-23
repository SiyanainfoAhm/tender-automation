const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SHAREPOINT_REQUEST_TIMEOUT_MS = 120_000;
const GRAPH_TRANSIENT_ATTEMPTS = 3;

async function boundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`SharePoint request timed out after ${SHAREPOINT_REQUEST_TIMEOUT_MS}ms`)), SHAREPOINT_REQUEST_TIMEOUT_MS);
  const upstream = init?.signal;
  const abort = () => controller.abort(upstream?.reason);
  upstream?.addEventListener("abort", abort, { once: true });
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); upstream?.removeEventListener("abort", abort); }
}

export type SharePointConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  hostname: string;
  sitePath: string;
  libraryName: string;
  rootFolder: string;
};

export type SharePointItem = {
  id: string;
  name: string;
  webUrl: string;
  size?: number;
  parentReference?: { driveId?: string; path?: string };
  "@microsoft.graph.downloadUrl"?: string;
};

export type SharePointUploadSession = {
  uploadUrl: string;
  expirationDateTime?: string;
};

export type SharePointGraphResponse = {
  operation: "createUploadSession";
  status: number;
  body: unknown;
};

export class SharePointGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "SharePointGraphError";
  }
}

let tokenCache: { token: string; expiresAt: number } | null = null;
let driveCache: { key: string; driveId: string } | null = null;

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing SharePoint secret: ${name}`);
  return value;
}

export function requireSharePointConfig(): SharePointConfig {
  return {
    tenantId: required("MICROSOFT_GRAPH_TENANT_ID"),
    clientId: required("MICROSOFT_GRAPH_CLIENT_ID"),
    clientSecret: required("MICROSOFT_GRAPH_CLIENT_SECRET"),
    hostname:
      Deno.env.get("SHAREPOINT_SITE_HOSTNAME")?.trim() ||
      "it1stop.sharepoint.com",
    sitePath:
      Deno.env.get("SHAREPOINT_SITE_PATH")?.trim() ||
      "/sites/SiyanaTenderDocumentRepository",
    libraryName:
      Deno.env.get("SHAREPOINT_LIBRARY_NAME")?.trim() || "TenderDocs",
    rootFolder:
      Deno.env.get("SHAREPOINT_TENDER_ARTIFACT_ROOT")?.trim() ||
      "companies/siyana-info-solutions-pvt-ltd_a1b2c3d4-e5f6-7890-abcd-ef1234567890/tender-artifacts",
  };
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function cleanPath(path: string): string {
  const cleaned = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
  if (!cleaned) throw new Error("SharePoint path is empty.");
  return cleaned;
}

async function graphToken(config: SharePointConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await boundedFetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    },
  );
  const body = await response.json().catch(() => ({})) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description || `Microsoft token request failed (${response.status}).`,
    );
  }
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(300, Number(body.expires_in) || 3600) * 1000,
  };
  return tokenCache.token;
}

async function graph(
  config: SharePointConfig,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await graphToken(config);
  const target = url.startsWith("http") ? url : `${GRAPH_BASE}${url}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < GRAPH_TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      const response = await boundedFetch(target, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
      if (![408, 429].includes(response.status) && response.status < 500) return response;
      if (attempt === GRAPH_TRANSIENT_ATTEMPTS - 1) return response;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (attempt === GRAPH_TRANSIENT_ATTEMPTS - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Microsoft Graph request failed after retries.");
}

async function graphJson<T>(
  config: SharePointConfig,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await graph(config, url, init);
  const body = await response.json().catch(() => ({})) as {
    error?: { message?: string };
  } & T;
  if (!response.ok) {
    throw new Error(
      body.error?.message || `Microsoft Graph request failed (${response.status}).`,
    );
  }
  return body;
}

export async function resolveSharePointDriveId(
  config = requireSharePointConfig(),
): Promise<string> {
  const key = `${config.hostname}|${config.sitePath}|${config.libraryName}`;
  if (driveCache?.key === key) return driveCache.driveId;
  const site = await graphJson<{ id: string }>(
    config,
    `/sites/${config.hostname}:${config.sitePath}?$select=id`,
  );
  const drives = await graphJson<{
    value: Array<{ id: string; name: string }>;
  }>(config, `/sites/${site.id}/drives?$select=id,name`);
  const drive = drives.value.find(
    (candidate) =>
      candidate.name.toLowerCase() === config.libraryName.toLowerCase(),
  );
  if (!drive) {
    throw new Error(
      `SharePoint document library "${config.libraryName}" was not found.`,
    );
  }
  driveCache = { key, driveId: drive.id };
  return drive.id;
}

export function tenderArtifactPath(
  config: SharePointConfig,
  options: {
    portal: string;
    date: string;
    tenderId: string;
    fileName: string;
  },
): string {
  const portal =
    String(options.portal).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") ||
    "manual";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(options.date)
    ? options.date
    : "undated";
  const tenderId =
    String(options.tenderId).replace(/^T247-/i, "").replace(/[^a-zA-Z0-9_-]/g, "") ||
    "unknown";
  const fileName =
    String(options.fileName).trim().replace(/[/\\]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-") ||
    "file.bin";
  return cleanPath(
    `${config.rootFolder}/${portal}/${date}/${tenderId}/${fileName}`,
  );
}

export async function getSharePointItemByPath(
  path: string,
  config = requireSharePointConfig(),
): Promise<SharePointItem | null> {
  const driveId = await resolveSharePointDriveId(config);
  const select = encodeURIComponent(
    "id,name,webUrl,size,parentReference,@microsoft.graph.downloadUrl",
  );
  const response = await graph(
    config,
    `${GRAPH_BASE}/drives/${driveId}/root:/${encodePath(cleanPath(path))}?$select=${select}`,
  );
  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({})) as SharePointItem & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      body.error?.message || `SharePoint lookup failed (${response.status}).`,
    );
  }
  return body;
}

/** Fetch immutable Graph metadata by existing drive item ID (no file bytes). */
export async function getSharePointItemById(
  itemId: string,
  config = requireSharePointConfig(),
): Promise<SharePointItem | null> {
  const driveId = await resolveSharePointDriveId(config);
  const select = encodeURIComponent("id,name,webUrl,size,parentReference");
  const response = await graph(config, `${GRAPH_BASE}/drives/${driveId}/items/${encodeURIComponent(itemId)}?$select=${select}`);
  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({})) as SharePointItem & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Microsoft Graph request failed (${response.status}).`);
  return body;
}

async function ensureSharePointFolder(
  folderPath: string,
  config: SharePointConfig,
): Promise<void> {
  const driveId = await resolveSharePointDriveId(config);
  const segments = cleanPath(folderPath).split("/");
  let parentId = "root";
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    const existing = await getSharePointItemByPath(current, config);
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const childrenEndpoint =
      parentId === "root"
        ? `/drives/${driveId}/root/children`
        : `/drives/${driveId}/items/${parentId}/children`;
    try {
      const created = await graphJson<SharePointItem>(
        config,
        childrenEndpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: segment,
            folder: {},
            "@microsoft.graph.conflictBehavior": "fail",
          }),
        },
      );
      parentId = created.id;
    } catch (error) {
      // Another request may have created the same folder concurrently.
      const raced = await getSharePointItemByPath(current, config);
      if (!raced) throw error;
      parentId = raced.id;
    }
  }
}

/**
 * Move an existing drive item without reading or re-uploading its bytes.
 * The caller must inspect target collisions before this operation.
 */
export async function moveSharePointItem(
  itemId: string,
  targetFolderPath: string,
  targetName: string,
  config = requireSharePointConfig(),
): Promise<SharePointItem> {
  await ensureSharePointFolder(targetFolderPath, config);
  const parent = await getSharePointItemByPath(targetFolderPath, config);
  if (!parent?.id) throw new Error("Target SharePoint folder was not created.");
  const driveId = await resolveSharePointDriveId(config);
  return graphJson<SharePointItem>(config, `/drives/${driveId}/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: targetName, parentReference: { id: parent.id } }),
  });
}

/** List every child below a folder, returning path-relative metadata only. */
export async function listSharePointFolderRecursive(
  folderPath: string,
  config = requireSharePointConfig(),
): Promise<Array<SharePointItem & { relativePath: string }>> {
  const root = await getSharePointItemByPath(folderPath, config);
  if (!root) return [];
  const driveId = await resolveSharePointDriveId(config);
  const result: Array<SharePointItem & { relativePath: string }> = [];
  const visit = async (parent: SharePointItem, prefix: string): Promise<void> => {
    let url = `${GRAPH_BASE}/drives/${driveId}/items/${encodeURIComponent(parent.id)}/children?$select=id,name,webUrl,size,parentReference,folder&$top=200`;
    while (url) {
      const page = await graphJson<{ value: Array<SharePointItem & { folder?: unknown }>; "@odata.nextLink"?: string }>(config, url);
      for (const child of page.value || []) {
        const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
        if (child.folder) await visit(child, relativePath);
        else result.push({ ...child, relativePath });
      }
      url = page["@odata.nextLink"] || "";
    }
  };
  await visit(root, "");
  return result;
}

export async function deleteEmptySharePointFolder(path: string, config = requireSharePointConfig()): Promise<boolean> {
  const folder = await getSharePointItemByPath(path, config);
  if (!folder) return true;
  const files = await listSharePointFolderRecursive(path, config);
  if (files.length) return false;
  const driveId = await resolveSharePointDriveId(config);
  const response = await graph(config, `${GRAPH_BASE}/drives/${driveId}/items/${encodeURIComponent(folder.id)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`Unable to delete SharePoint folder (${response.status}).`);
  return true;
}

export async function uploadSharePointFile(
  path: string,
  file: File,
  config = requireSharePointConfig(),
): Promise<{ item: SharePointItem; existed: boolean; path: string }> {
  const clean = cleanPath(path);
  const existing = await getSharePointItemByPath(clean, config);
  if (existing) return { item: existing, existed: true, path: clean };

  const parent = clean.slice(0, clean.lastIndexOf("/"));
  await ensureSharePointFolder(parent, config);
  const driveId = await resolveSharePointDriveId(config);
  const session = await graphJson<SharePointUploadSession>(
    config,
    `/drives/${driveId}/root:/${encodePath(clean)}:/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": "fail" },
      }),
    },
  );

  const chunkBytes = 10 * 1024 * 1024; // 32 × 320 KiB
  let completed: SharePointItem | null = null;
  for (let start = 0; start < file.size; start += chunkBytes) {
    const end = Math.min(file.size, start + chunkBytes);
    // Upload-session URLs are preauthenticated; do not send Graph bearer token.
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await boundedFetch(session.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(end - start),
          "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
        },
        body: file.slice(start, end),
      });
      if (
        ![408, 429, 500, 501, 502, 503, 504].includes(response.status) ||
        attempt === 2
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
    if (!response) throw new Error("SharePoint upload failed.");
    const body = await response.json().catch(() => ({})) as SharePointItem & {
      error?: { code?: string; message?: string };
    };
    if (response.status === 409 || body.error?.code === "nameAlreadyExists") {
      const raced = await getSharePointItemByPath(clean, config);
      if (raced) return { item: raced, existed: true, path: clean };
    }
    if (![200, 201, 202].includes(response.status)) {
      throw new Error(
        body.error?.message || `SharePoint upload failed (${response.status}).`,
      );
    }
    if (response.status === 200 || response.status === 201) completed = body;
  }
  if (!completed?.webUrl) {
    completed = await getSharePointItemByPath(clean, config);
  }
  if (!completed?.webUrl) throw new Error("SharePoint upload did not complete.");
  return { item: completed, existed: false, path: clean };
}

export async function createSharePointUploadSession(
  path: string,
  config = requireSharePointConfig(),
  options?: { overwrite?: boolean; onGraphResponse?: (response: SharePointGraphResponse) => void },
): Promise<
  | { existed: true; item: SharePointItem; path: string }
  | { existed: false; session: SharePointUploadSession; path: string }
> {
  const clean = cleanPath(path);
  const existing = await getSharePointItemByPath(clean, config);
  if (existing && !options?.overwrite) return { existed: true, item: existing, path: clean };

  await ensureSharePointFolder(clean.slice(0, clean.lastIndexOf("/")), config);
  const driveId = await resolveSharePointDriveId(config);
  const response = await graph(
    config,
    `/drives/${driveId}/root:/${encodePath(clean)}:/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": options?.overwrite ? "replace" : "fail" },
      }),
    },
  );
  const body = await response.json().catch(() => ({})) as SharePointUploadSession & { error?: { message?: string } };
  options?.onGraphResponse?.({ operation: "createUploadSession", status: response.status, body });
  if (!response.ok) throw new SharePointGraphError(body.error?.message || `Microsoft Graph request failed (${response.status}).`, response.status, body);
  const session = body;
  return { existed: false, session, path: clean };
}

/**
 * Forward one Content-Range chunk to a Graph upload-session URL.
 * Chunk sizes (except the last) must be multiples of 320 KiB.
 */
export async function putSharePointUploadChunk(options: {
  uploadUrl: string;
  bytes: Uint8Array;
  start: number;
  totalSize: number;
}): Promise<{ complete: boolean; item: SharePointItem | null; nextExpectedByte?: number }> {
  const end = options.start + options.bytes.byteLength - 1;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await boundedFetch(options.uploadUrl, {
      method: "PUT",
      headers: { "Content-Length": String(options.bytes.byteLength), "Content-Range": `bytes ${options.start}-${end}/${options.totalSize}` },
      body: Uint8Array.from(options.bytes).buffer,
    });
    if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt));
  }
  if (!response) throw new Error("SharePoint chunk upload failed.");
  const body = (await response.json().catch(() => ({}))) as SharePointItem & {
    error?: { code?: string; message?: string };
  };
  if (![200, 201, 202].includes(response.status)) {
    throw new Error(
      body.error?.message ||
        `SharePoint chunk upload failed (${response.status}).`,
    );
  }
  if (response.status === 200 || response.status === 201) {
    return { complete: true, item: body.webUrl ? body : null };
  }
  const uploadState = body as unknown as { nextExpectedRanges?: unknown };
  const next = Array.isArray(uploadState.nextExpectedRanges)
    ? String(uploadState.nextExpectedRanges[0] || "").match(/^(\d+)-/) : null;
  return { complete: false, item: null, ...(next ? { nextExpectedByte: Number(next[1]) } : {}) };
}

/** True when a stored URL points at SharePoint (legacy Azure otherwise). */
export function isSharePointStorageUrl(
  url: string | null | undefined,
): boolean {
  if (!url?.trim()) return false;
  try {
    return new URL(url.trim()).hostname
      .toLowerCase()
      .endsWith(".sharepoint.com");
  } catch {
    return false;
  }
}

function relativePathFromWebUrl(
  storageUrl: string,
  config: SharePointConfig,
): string | null {
  try {
    const url = new URL(storageUrl);
    if (url.hostname.toLowerCase() !== config.hostname.toLowerCase()) return null;
    const marker = `/${config.libraryName}/`;
    const candidates = [
      decodeURIComponent(url.pathname),
      decodeURIComponent(url.searchParams.get("id") || ""),
      decodeURIComponent(url.searchParams.get("RootFolder") || ""),
    ].filter(Boolean);
    for (const candidate of candidates) {
      const index = candidate.toLowerCase().indexOf(marker.toLowerCase());
      if (index >= 0) {
        return cleanPath(candidate.slice(index + marker.length));
      }
    }
    // Already a library-relative path (no host prefix).
    const raw = String(storageUrl || "").trim().replace(/^\/+/, "");
    if (
      raw &&
      !raw.includes("://") &&
      !raw.includes("?") &&
      raw.toLowerCase().startsWith("companies/")
    ) {
      return cleanPath(raw);
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchSharePointDownload(
  item: SharePointItem,
  config: SharePointConfig,
): Promise<Response> {
  // Prefer the short-lived preauthenticated download URL (no bearer token).
  const directUrl = item["@microsoft.graph.downloadUrl"]?.trim();
  if (directUrl) {
    const direct = await boundedFetch(directUrl, { redirect: "follow" });
    if (direct.ok) return direct;
  }

  const driveId =
    item.parentReference?.driveId || (await resolveSharePointDriveId(config));
  // Graph /content returns a 302 to a preauthenticated CDN URL. Do NOT forward
  // the Graph bearer token on that hop — SharePoint rejects it.
  const response = await graph(
    config,
    `${GRAPH_BASE}/drives/${driveId}/items/${item.id}/content`,
    { redirect: "manual" },
  );
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("Location");
    if (!location) {
      throw new Error("SharePoint download redirect was missing.");
    }
    const absolute =
      location.startsWith("http://") || location.startsWith("https://")
        ? location
        : new URL(location, GRAPH_BASE).toString();
    const redirected = await boundedFetch(absolute, { redirect: "follow" });
    if (!redirected.ok) {
      throw new Error(`SharePoint download failed (${redirected.status}).`);
    }
    return redirected;
  }
  if (!response.ok) {
    throw new Error(`SharePoint download failed (${response.status}).`);
  }
  return response;
}

export async function resolveSharePointItem(
  options: { storageUrl?: string | null; path?: string | null },
  config = requireSharePointConfig(),
): Promise<SharePointItem | null> {
  const path =
    String(options.path || "").trim() ||
    relativePathFromWebUrl(String(options.storageUrl || "").trim(), config);
  if (path) return getSharePointItemByPath(path, config);
  return null;
}

export async function readSharePointFile(
  options: { storageUrl?: string | null; path?: string | null },
  config = requireSharePointConfig(),
): Promise<{ response: Response; item: SharePointItem }> {
  const item = await resolveSharePointItem(options, config);
  if (!item) throw new Error("File not found in SharePoint.");
  const response = await fetchSharePointDownload(item, config);
  return { response, item };
}

export async function deleteSharePointFile(
  options: { storageUrl?: string | null; path?: string | null },
  config = requireSharePointConfig(),
): Promise<void> {
  const item = await resolveSharePointItem(options, config);
  if (!item) return;
  const driveId =
    item.parentReference?.driveId || (await resolveSharePointDriveId(config));
  const response = await graph(
    config,
    `${GRAPH_BASE}/drives/${driveId}/items/${item.id}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`SharePoint delete failed (${response.status}).`);
  }
}
