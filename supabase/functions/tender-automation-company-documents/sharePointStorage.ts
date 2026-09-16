const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

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
};

export type SharePointUploadSession = {
  uploadUrl: string;
  expirationDateTime?: string;
};

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
  const response = await fetch(
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
  return fetch(url.startsWith("http") ? url : `${GRAPH_BASE}${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
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
  const response = await graph(
    config,
    `${GRAPH_BASE}/drives/${driveId}/root:/${encodePath(cleanPath(path))}?$select=id,name,webUrl,size,parentReference`,
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
    const response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - start),
        "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
      },
      body: file.slice(start, end),
    });
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
): Promise<
  | { existed: true; item: SharePointItem; path: string }
  | { existed: false; session: SharePointUploadSession; path: string }
> {
  const clean = cleanPath(path);
  const existing = await getSharePointItemByPath(clean, config);
  if (existing) return { existed: true, item: existing, path: clean };

  await ensureSharePointFolder(clean.slice(0, clean.lastIndexOf("/")), config);
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
  return { existed: false, session, path: clean };
}

function relativePathFromWebUrl(
  storageUrl: string,
  config: SharePointConfig,
): string | null {
  try {
    const url = new URL(storageUrl);
    if (url.hostname.toLowerCase() !== config.hostname.toLowerCase()) return null;
    const marker = `/${config.libraryName}/`;
    const decoded = decodeURIComponent(url.pathname);
    const index = decoded.toLowerCase().indexOf(marker.toLowerCase());
    return index >= 0 ? cleanPath(decoded.slice(index + marker.length)) : null;
  } catch {
    return null;
  }
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
  const driveId =
    item.parentReference?.driveId || (await resolveSharePointDriveId(config));
  const response = await graph(
    config,
    `${GRAPH_BASE}/drives/${driveId}/items/${item.id}/content`,
  );
  if (!response.ok) {
    throw new Error(`SharePoint download failed (${response.status}).`);
  }
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
