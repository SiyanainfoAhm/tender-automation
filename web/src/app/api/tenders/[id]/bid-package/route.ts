export const maxDuration = 300;
export const dynamic = "force-dynamic";

import JSZip from "jszip";
import { NextResponse } from "next/server";

import { getServerSupabase } from "@/lib/db/server";
import { checklistWorkCategory, WORK_CATEGORIES } from "@/lib/will-bid";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { loadBidWorkspace } from "@/server/repositories/bidWorkspaceRepository";
import {
  listChecklistItems,
  type ChecklistItemRow,
} from "@/server/repositories/bidChecklistRepository";

type RouteContext = { params: Promise<{ id: string }> };

/** Characters Windows and zip tools reject in file names. */
function safeName(value: string, max = 90): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "document").slice(0, max).trim();
}

function extensionFor(fileName: string | null, contentType: string | null): string {
  const fromName = fileName?.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (fromName) return `.${fromName.toLowerCase()}`;
  const type = (contentType || "").toLowerCase();
  if (type.includes("pdf")) return ".pdf";
  if (type.includes("wordprocessingml")) return ".docx";
  if (type.includes("spreadsheetml")) return ".xlsx";
  if (type.includes("presentationml")) return ".pptx";
  if (type.includes("png")) return ".png";
  if (type.includes("jpeg")) return ".jpg";
  return "";
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Downloads every current checklist document for a Will Bid tender as one ZIP,
 * grouped by checklist category, plus an index of what is attached and missing.
 */
export async function GET(request: Request, context: RouteContext) {
  let session;
  try {
    session = await requirePermissionStrict("bids.view");
  } catch {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  const { id: tenderId } = await context.params;
  const supabase = getServerSupabase();
  const { data: workspaceRow, error } = await supabase
    .from("agenttender_bid_workspaces")
    .select("id")
    .eq("tender_id", tenderId)
    .eq("company_id", session.companyId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!workspaceRow) {
    return NextResponse.json(
      { success: false, error: "Bid workspace not found for this tender." },
      { status: 404 },
    );
  }

  const { data: tender } = await supabase
    .from("agenttender_tenders")
    .select("title, source_tender_id, reference_no")
    .eq("id", tenderId)
    .maybeSingle();

  const workspace = await loadBidWorkspace({
    workspaceId: String(workspaceRow.id),
    companyId: session.companyId,
  });
  if (!workspace) {
    return NextResponse.json(
      { success: false, error: "Bid workspace not found." },
      { status: 404 },
    );
  }
  const items = await listChecklistItems({
    workspaceId: workspace.id,
    companyId: session.companyId,
    workspaceDocuments: workspace.documents,
  });

  // Reuse the app's own document routes so storage resolution (SharePoint,
  // Azure, signed drafts) and access checks stay in one place.
  const origin = new URL(request.url).origin;
  const cookie = request.headers.get("cookie") || "";

  async function fetchDocument(item: ChecklistItemRow) {
    const doc = item.documents[0];
    if (!doc?.downloadHref) return null;
    const url = new URL(doc.downloadHref, origin);
    url.searchParams.set("download", "1");
    const response = await fetch(url, { headers: { cookie }, cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error("empty file");
    return {
      bytes,
      ext: extensionFor(doc.fileName || doc.title, response.headers.get("content-type")),
      title: doc.fileName || doc.title,
    };
  }

  const zip = new JSZip();
  const rows: string[] = [
    ["No", "Category", "Requirement", "Status", "File in ZIP", "Note"].map(csvCell).join(","),
  ];
  const usedNames = new Set<string>();
  const folders = new Map(
    WORK_CATEGORIES.map((category, index) => [
      category.key as string,
      `${index + 1} ${category.label}`,
    ]),
  );

  let counter = 0;
  const queue = items.map((item) => ({ item, no: ++counter }));
  const results: Array<{ no: number; item: ChecklistItemRow; path: string | null; note: string }> = [];

  // Small concurrency so large tenders finish quickly without overloading storage.
  async function worker() {
    while (queue.length) {
      const next = queue.shift();
      if (!next) return;
      const { item, no } = next;
      const folder = folders.get(checklistWorkCategory(item)) || "Other";
      try {
        const file = await fetchDocument(item);
        if (!file) {
          results.push({ no, item, path: null, note: "No document attached" });
          continue;
        }
        const base = `${String(no).padStart(2, "0")} - ${safeName(item.requirementName, 70)}`;
        let path = `${folder}/${base}${file.ext}`;
        let dup = 2;
        while (usedNames.has(path.toLowerCase())) {
          path = `${folder}/${base} (${dup++})${file.ext}`;
        }
        usedNames.add(path.toLowerCase());
        zip.file(path, file.bytes, { binary: true });
        results.push({ no, item, path, note: file.title || "" });
      } catch (reason) {
        results.push({
          no,
          item,
          path: null,
          note: `Could not download: ${reason instanceof Error ? reason.message : "error"}`,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()));

  results.sort((a, b) => a.no - b.no);
  for (const result of results) {
    const category =
      WORK_CATEGORIES.find((entry) => entry.key === checklistWorkCategory(result.item))?.label ||
      "Other";
    rows.push(
      [
        String(result.no),
        category,
        result.item.requirementName,
        result.path ? "Attached" : result.item.isCompleted ? "Marked done (no file)" : "Missing",
        result.path || "",
        result.note,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  zip.file("00 Checklist index.csv", "﻿" + rows.join("\r\n"));

  const reference = tender?.reference_no || tender?.source_tender_id || tenderId.slice(0, 8);
  const zipName = `${safeName(`Bid package ${reference}`, 80)}.zip`;

  const stream = zip.generateInternalStream({
    type: "uint8array",
    streamFiles: true,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream
        .on("data", (chunk: Uint8Array) => controller.enqueue(chunk))
        .on("error", (reason: Error) => controller.error(reason))
        .on("end", () => controller.close())
        .resume();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      "Cache-Control": "no-store",
    },
  });
}
