import { inspectVisualSignature } from "./visual-signature.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { inspectedText, nativeText } from "./file-reader.ts";
import { readSource, byteHash } from "./source-files.ts";
import { reviewDocument, actualText } from "./document-review.ts";
import { RULE_VERSION } from "./checklist-rules.ts";

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { unzipSync, zipSync, strFromU8, strToU8 } from "npm:fflate@0.8.2";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFName,
  PDFDict,
  PDFRawStream,
  decodePDFRawStream,
} from "npm:pdf-lib@1.17.1";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  base = Deno.env.get("SUPABASE_URL") || "";
const db = createClient(base, key, { auth: { persistSession: false } });
const check = (r: any) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const enc = (s: any) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const sha = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
const cache = new Map<string, any>();
async function config(company: string) {
  if (cache.has(company)) return cache.get(company);
  const prefs = check(
    await db
      .from("agenttender_company_bid_preferences")
      .select("extras")
      .eq("company_id", company)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single(),
  );
  const cfg = prefs.extras?.document_signing,
    profile = prefs.extras?.production_company_profile || {};
  if (
    !cfg?.enabled ||
    cfg.use_only_approved_company_asset !== true ||
    !cfg.asset_image_drive_id ||
    !cfg.asset_image_item_id
  )
    throw Error("APPROVED_SIGNING_ASSET_NOT_CONFIGURED");
  const tenant = Deno.env.get("MICROSOFT_GRAPH_TENANT_ID") || Deno.env.get("MS_GRAPH_TENANT_ID"),
    client = Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID") || Deno.env.get("MS_GRAPH_CLIENT_ID"),
    secret = Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET") || Deno.env.get("MS_GRAPH_CLIENT_SECRET");
  const tr = await fetch("https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: client || "",
      client_secret: secret || "",
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(20000),
  });
  const tj = await tr.json();
  if (!tr.ok || !tj.access_token) throw Error("GRAPH_TOKEN_HTTP_" + tr.status);
  const ar = await fetch(
    "https://graph.microsoft.com/v1.0/drives/" +
      encodeURIComponent(cfg.asset_image_drive_id) +
      "/items/" +
      encodeURIComponent(cfg.asset_image_item_id) +
      "/content",
    { headers: { Authorization: "Bearer " + tj.access_token }, signal: AbortSignal.timeout(25000) },
  );
  if (!ar.ok) throw Error("SIGNING_ASSET_HTTP_" + ar.status);
  const image = new Uint8Array(await ar.arrayBuffer());
  if (image.length < 1000 || image[0] !== 137 || image[1] !== 80) throw Error("INVALID_APPROVED_PNG");
  const dv = new DataView(image.buffer, image.byteOffset, image.byteLength),
    width = dv.getUint32(16),
    height = dv.getUint32(20);
  const result = { cfg, profile, token: tj.access_token, image, imageHash: await sha(image), width, height };
  cache.set(company, result);
  return result;
}
async function bytesFor(d: any, c: any) {
  return await readSource(db, d, c.cfg.asset_image_drive_id);
}

function drawing(w: number, h: number, id: number) {
  return (
    '<w:r><w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' +
    w +
    '" cy="' +
    h +
    '"/><wp:docPr id="' +
    id +
    '" name="Approved company signature and seal"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Approved company signature and seal"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdVBDCApprovedSignV2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' +
    w +
    '" cy="' +
    h +
    '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}
// Footer paragraphs that carry a page number field (PAGE / NUMPAGES). The signed footer adds the
// single "Name | Page X of Y" line, so any earlier page-number line (generator "DRAFT · Page",
// technical-proposal footer, or a previous signing pass) is removed to avoid duplicates.
const FOOTER_PARAGRAPH = /<w:p\b(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g;
function isPageNumberParagraph(p: string) {
  return (
    /<w:fldSimple\b[^>]*w:instr="\s*(?:PAGE|NUMPAGES|SECTIONPAGES)\b/i.test(p) ||
    /<w:instrText\b[^>]*>\s*(?:PAGE|NUMPAGES|SECTIONPAGES)\b/i.test(p)
  );
}
function isEmptyParagraph(p: string) {
  const body = p.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/, "");
  return !/<w:t\b|<w:drawing\b|<w:pict\b|<w:object\b|<w:fldSimple\b|<w:instrText\b|<w:tab\b|<w:sym\b/.test(body);
}
function cleanSignedFooter(xml: string) {
  // Remove previous VBDC sign blocks (tagged) and every page-number paragraph.
  let out = xml.replace(
    /<w:sdt>(?:(?!<w:sdt>)[\s\S])*?<w:tag w:val="VBDC_FOOTER_SIGN_V3"\/>[\s\S]*?<\/w:sdtContent><\/w:sdt>/g,
    "",
  );
  out = out.replace(FOOTER_PARAGRAPH, (p: string) => (isPageNumberParagraph(p) ? "" : p));
  // Drop right-aligned empty paragraphs left behind after an approved drawing was removed.
  out = out.replace(FOOTER_PARAGRAPH, (p: string) =>
    /<w:jc w:val="right"\/>/.test(p) && isEmptyParagraph(p) ? "" : p,
  );
  // A table cell must keep at least one paragraph.
  out = out.replace(/<w:tc\b[^>]*>((?:(?!<w:tc\b)[\s\S])*?)<\/w:tc>/g, (m: string, inner: string) =>
    /<w:p\b/.test(inner) ? m : m.replace("</w:tc>", "<w:p/></w:tc>"),
  );
  return out;
}
function footerMarkerCount(xml: string) {
  return (xml.match(FOOTER_PARAGRAPH) || []).filter(isPageNumberParagraph).length;
}
function patchDocx(bytes: Uint8Array, c: any, every = false) {
  const zip: any = unzipSync(bytes);
  if (!zip["word/document.xml"]) throw Error("INVALID_DOCX_PACKAGE");
  const xml = strFromU8(zip["word/document.xml"]);
  if (Object.keys(zip).some((n) => n.startsWith("_xmlsignatures/")))
    throw Error("CRYPTOGRAPHICALLY_SIGNED_ORIGINAL_PRESERVED");
  const media = "word/media/vbdc-approved-signature-v2.png";
  // Remove only drawings that reference the byte-identical approved asset. Keep all source text.
  const approvedMedia = Object.keys(zip).filter(
    (n) =>
      n.startsWith("word/media/") &&
      zip[n].length === c.image.length &&
      zip[n].every((v: number, k: number) => v === c.image[k]),
  );
  let removedApprovedDrawings = 0;
  if (every)
    for (const part of Object.keys(zip).filter((n) => /^word\/(?:document|footer[^/]*|header[^/]*)\.xml$/.test(n))) {
      const rp = "word/_rels/" + part.split("/").pop() + ".rels",
        rs = strFromU8(zip[rp] || new Uint8Array());
      const ids = (rs.match(/<Relationship\b[^>]*\/?\s*>/g) || [])
        .filter((t) =>
          approvedMedia.some((m) => t.includes('Target="' + m.slice(5) + '"') || t.includes('Target="/' + m + '"')),
        )
        .map((t) => t.match(/Id="([^\"]+)"/)?.[1])
        .filter(Boolean);
      const before = strFromU8(zip[part]);
      const clean = before.replace(/<w:drawing\b[^>]*>[\s\S]*?<\/w:drawing>/g, (drawing: string) => {
        if (ids.some((id) => drawing.includes('r:embed="' + id + '"'))) {
          removedApprovedDrawings++;
          return "";
        }
        return drawing;
      });
      zip[part] = strToU8(clean);
    }
  const cleanXml = strFromU8(zip["word/document.xml"]);

  const text = xml.replace(/<[^>]+>/g, " ");
  if (/TO BE CONFIRMED|\[TODO\]|\[TO BE|DRAFT - HUMAN REVIEW|LOREM IPSUM|\[PLACEHOLDER\]/i.test(text))
    throw Error("CONTENT_REPAIR_REQUIRED_BEFORE_SIGNING");
  const hasApprovedImage = Object.keys(zip).some(
    (n) =>
      n.startsWith("word/media/") &&
      zip[n].length === c.image.length &&
      zip[n].every((v: number, k: number) => v === c.image[k]),
  );
  zip[media] = c.image;
  let rels = zip["word/_rels/document.xml.rels"]
    ? strFromU8(zip["word/_rels/document.xml.rels"])
    : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const imageRel =
    '<Relationship Id="rIdVBDCApprovedSignV2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/vbdc-approved-signature-v2.png"/>';
  if (!rels.includes('Id="rIdVBDCApprovedSignV2"'))
    rels = rels.replace("</Relationships>", imageRel + "</Relationships>");
  const bodyW = Math.round(112 * 9525),
    bodyH = Math.round((bodyW * c.height) / c.width);
  const footerH = Math.round(66 * 9525),
    footerW = Math.round((footerH * c.width) / c.height);
  const name = enc(c.profile.authorized_signatory_name || "Authorized Signatory"),
    company = enc(c.profile.legal_name || "Siyana Info Solutions Private Limited");
  const line = (s: string, last = false) =>
    "<w:p><w:pPr>" +
    (last ? "" : "<w:keepNext/>") +
    '<w:keepLines/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>' +
    s +
    "</w:t></w:r></w:p>";
  const block =
    every || hasApprovedImage
      ? '<w:sdt><w:sdtPr><w:tag w:val="VBDC_APPROVED_SIGN_V2"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>'
      : '<w:sdt><w:sdtPr><w:tag w:val="VBDC_APPROVED_SIGN_V2"/></w:sdtPr><w:sdtContent>' +
        line("For " + company) +
        "<w:p><w:pPr><w:keepNext/><w:keepLines/></w:pPr>" +
        drawing(bodyW, bodyH, 1900001) +
        "</w:p>" +
        line(name) +
        line(enc(c.profile.authorized_signatory_designation || "Authorized Signatory"), true) +
        "</w:sdtContent></w:sdt>";
  let doc = every ? cleanXml : xml;
  if (!doc.includes("VBDC_APPROVED_SIGN_V2")) {
    const p = doc.lastIndexOf("<w:sectPr");
    doc = p >= 0 ? doc.slice(0, p) + block + doc.slice(p) : doc.replace("</w:body>", block + "</w:body>");
  }
  if (!every) {
    let ct = strFromU8(zip["[Content_Types].xml"]);
    if (!/Extension="png"/i.test(ct))
      ct = ct.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
    zip["[Content_Types].xml"] = strToU8(ct);
    zip["word/document.xml"] = strToU8(doc);
    zip["word/_rels/document.xml.rels"] = strToU8(rels);
    return { bytes: zipSync(zip, { level: 6 }), already: false, kind: "docx", every_page: false };
  }
  const footerMarker =
    '<w:sdt><w:sdtPr><w:tag w:val="VBDC_FOOTER_SIGN_V3"/></w:sdtPr><w:sdtContent>' +
    '<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="0" w:after="0"/></w:pPr>' +
    drawing(footerW, footerH, 1900002) +
    '</w:p><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>' +
    name +
    ' | Page </w:t></w:r><w:fldSimple w:instr="PAGE"/><w:r><w:t> of </w:t></w:r><w:fldSimple w:instr="NUMPAGES"/></w:p>' +
    "</w:sdtContent></w:sdt>";
  const footerNames = Object.keys(zip).filter((n) => /^word\/footer[^/]*\.xml$/.test(n));
  const newFooter = "word/footerVBDCSignV2.xml";
  if (!footerNames.includes(newFooter)) {
    zip[newFooter] = strToU8('<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:ftr>');
    footerNames.push(newFooter);
  }
  for (const file of footerNames) {
    let f = cleanSignedFooter(strFromU8(zip[file]));
    f = f.replace(/<w:ftr([^>]*)\/>/, "<w:ftr$1></w:ftr>");
    f = f.replace("</w:ftr>", footerMarker + "</w:ftr>");
    zip[file] = strToU8(f);
    const rp = "word/_rels/" + file.split("/").pop() + ".rels";
    let r = zip[rp]
      ? strFromU8(zip[rp]).replace(/<Relationships([^>]*)\/>/, "<Relationships$1></Relationships>")
      : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    if (!r.includes('Id="rIdVBDCApprovedSignV2"')) r = r.replace("</Relationships>", imageRel + "</Relationships>");
    zip[rp] = strToU8(r);
  }
  if (!rels.includes('Id="rIdVBDCFooterV2"'))
    rels = rels.replace(
      "</Relationships>",
      '<Relationship Id="rIdVBDCFooterV2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footerVBDCSignV2.xml"/></Relationships>',
    );
  doc = doc.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g, (sect: string) => {
    for (const type of ["default", "first", "even"])
      if (!new RegExp('<w:footerReference[^>]*w:type="' + type + '"').test(sect))
        sect = sect.replace(
          /(<w:sectPr\b[^>]*>)/,
          '$1<w:footerReference w:type="' +
            type +
            '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdVBDCFooterV2"/>',
        );
    return sect.replace(/<w:pgMar\b[^>]*\/>/g, (m: string) => {
      m = m.replace(/w:bottom="\d+"/, 'w:bottom="2160"').replace(/w:footer="\d+"/, 'w:footer="180"');
      return m;
    });
  });
  let ct = strFromU8(zip["[Content_Types].xml"]);
  if (!/Extension="png"/i.test(ct))
    ct = ct.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
  if (!ct.includes("/word/footerVBDCSignV2.xml"))
    ct = ct.replace(
      "</Types>",
      '<Override PartName="/word/footerVBDCSignV2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
    );
  zip["[Content_Types].xml"] = strToU8(ct);
  zip["word/document.xml"] = strToU8(doc);
  zip["word/_rels/document.xml.rels"] = strToU8(rels);
  const output = zipSync(zip, { level: 6 }),
    verify = unzipSync(output);
  if (!verify[media] || !strFromU8(verify["word/document.xml"]).includes("VBDC_APPROVED_SIGN_V2"))
    throw Error("DOCX_SIGNING_VERIFICATION_FAILED");
  return { bytes: output, already: false, kind: "docx", every_page: true };
}
async function patchPdf(bytes: Uint8Array, c: any, every = false) {
  const src = await PDFDocument.load(bytes);
  if (
    src.context
      .enumerateIndirectObjects()
      .some(
        ([, o]: any) =>
          o instanceof PDFDict && (o.has(PDFName.of("ByteRange")) || o.get(PDFName.of("Type"))?.toString() === "/Sig"),
      )
  )
    throw Error("DIGITAL_SIGNATURE_REQUIRED: cryptographically signed source preserved");
  let signed = await pdfSignedPages(src, c);
  if (signed.some((n: number) => n > 1)) {
    await pdfSignedPages(src, { ...c, remove_approved_images: true });
    signed = src.getPages().map(() => 0);
    c.visual_signed_pages = [];
  }
  const png = await src.embedPng(c.image),
    font = await src.embedFont(StandardFonts.Helvetica),
    pages = src.getPages();
  for (let n = 0; n < pages.length; n++) {
    if (signed[n] === 1 || c.visual_signed_pages?.includes(n + 1) || (!every && n !== pages.length - 1)) continue;
    const page = pages[n],
      box = page.getMediaBox();
    if (page.getRotation().angle !== 0) throw Error("SIGNATURE_PLACEMENT_UNSUPPORTED_ROTATED_PAGE");
    page.setMediaBox(box.x, box.y - 108, box.width, box.height + 108);
    page.setCropBox(box.x, box.y - 108, box.width, box.height + 108);
    const h = 76,
      w = (h * c.width) / c.height;
    page.drawImage(png, { x: box.x + box.width - w - 28, y: box.y - 96, width: w, height: h });
    page.drawText("For " + String(c.profile.legal_name), { x: box.x + 24, y: box.y - 48, size: 8, font });
    page.drawText(
      String(c.profile.authorized_signatory_name) + " | " + String(c.profile.authorized_signatory_designation),
      { x: box.x + 24, y: box.y - 63, size: 8, font },
    );
    page.drawText("Submission copy | Page " + (n + 1) + " of " + pages.length, {
      x: box.x + 24,
      y: box.y - 78,
      size: 8,
      font,
    });
  }
  src.setKeywords([...(src.getKeywords() ? [src.getKeywords()!] : []), "VBDC_SIGN_V4", c.imageHash]);
  const output = await src.save();
  if ((await PDFDocument.load(output)).getPageCount() !== pages.length) throw Error("PDF_PAGE_COUNT_CHANGED");
  return { bytes: output, already: false, kind: "pdf", pages: pages.length, every_page: every };
}
async function pdfSignedPages(pdf: any, c: any) {
  const template = await PDFDocument.create(),
    png = await template.embedPng(c.image);
  await template.save();
  const expected: any = template.context.lookup(png.ref);
  if (!(expected instanceof PDFRawStream)) return pdf.getPages().map(() => false);
  const expectedHash = await sha(decodePDFRawStream(expected).decode()),
    matching = new Set<string>();
  for (const [ref, obj] of pdf.context.enumerateIndirectObjects())
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype"))?.toString() === "/Image") {
      try {
        if ((await sha(decodePDFRawStream(obj).decode())) === expectedHash) matching.add(ref.toString());
      } catch {}
    }
  const painted = (resources: any, streams: any[], visited = new Set<string>()): number => {
    const xo = resources?.lookup(PDFName.of("XObject"));
    if (!(xo instanceof PDFDict)) return 0;
    let count = 0;
    for (const ref of streams) {
      const st = pdf.context.lookup(ref);
      if (!(st instanceof PDFRawStream)) continue;
      let ops: string;
      try {
        ops = new TextDecoder("latin1").decode(decodePDFRawStream(st).decode());
      } catch {
        throw Error("PDF_SIGNATURE_STREAM_UNREADABLE");
      }
      for (const op of ops.matchAll(/(\/[^\s\[\]()<>{}%]+)\s+Do\b/g)) {
        const target = xo.get(PDFName.of(op[1].slice(1)));
        if (!target) continue;
        if (matching.has(target.toString())) {
          count++;
          continue;
        }
        const form = pdf.context.lookup(target);
        if (visited.has(target.toString())) continue;
        if (form instanceof PDFRawStream && form.dict.get(PDFName.of("Subtype"))?.toString() === "/Form") {
          const next = new Set(visited);
          next.add(target.toString());
          count += painted(form.dict.lookup(PDFName.of("Resources")) || resources, [target], next);
        }
      }
    }
    return count;
  };
  const counts = pdf.getPages().map((pg: any) => {
    const cs = pg.node.Contents();
    return painted(pg.node.Resources(), cs?.asArray ? cs.asArray() : cs ? [cs] : []);
  });
  if (c.remove_approved_images) {
    const rewritten = new Set<string>();
    const strip = (resources: any, streams: any[], visited = new Set<string>()) => {
      const xo = resources?.lookup(PDFName.of("XObject"));
      if (!(xo instanceof PDFDict)) return;
      for (const ref of streams) {
        if (rewritten.has(ref.toString())) continue;
        const st = pdf.context.lookup(ref);
        if (!(st instanceof PDFRawStream)) continue;
        const raw = decodePDFRawStream(st).decode();
        let ops = "";
        for (const b of raw) ops += String.fromCharCode(b);
        const clean = ops.replace(/(\/[^\s\[\]()<>{}%]+)\s+Do\b/g, (op: string, name: string) => {
          const target = xo.get(PDFName.of(name.slice(1)));
          if (!target) return op;
          if (matching.has(target.toString())) return " ";
          const form = pdf.context.lookup(target);
          if (
            !visited.has(target.toString()) &&
            form instanceof PDFRawStream &&
            form.dict.get(PDFName.of("Subtype"))?.toString() === "/Form"
          ) {
            const next = new Set(visited);
            next.add(target.toString());
            strip(form.dict.lookup(PDFName.of("Resources")) || resources, [target], next);
          }
          return op;
        });
        if (clean !== ops) {
          const dict = st.dict.clone();
          dict.delete(PDFName.of("Filter"));
          dict.delete(PDFName.of("DecodeParms"));
          const data = Uint8Array.from(clean, (x: string) => x.charCodeAt(0));
          pdf.context.assign(ref, PDFRawStream.of(dict, data));
        }
        rewritten.add(ref.toString());
      }
    };
    for (const pg of pdf.getPages()) {
      const cs = pg.node.Contents();
      strip(pg.node.Resources(), cs?.asArray ? cs.asArray() : cs ? [cs] : []);
    }
  }
  return counts;
}

async function downloadUrl(path: string, name: string) {
  const ck = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", ck, new TextEncoder().encode(path)))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return (
    base +
    "/functions/v1/agenttender-bid-draft-download?path=" +
    encodeURIComponent(path) +
    "&sig=" +
    sig +
    "&name=" +
    encodeURIComponent(name) +
    "&download=1"
  );
}
async function signaturePresent(bytes: Uint8Array, c: any, kind: string, every: boolean) {
  if (kind === "docx") {
    const z: any = unzipSync(bytes),
      media = Object.keys(z).filter(
        (n) =>
          n.startsWith("word/media/") &&
          z[n].length === c.image.length &&
          z[n].every((v: number, k: number) => v === c.image[k]),
      );
    if (!media.length) return false;
    function linked(part: string) {
      const rel = "word/_rels/" + part.split("/").pop() + ".rels",
        rs = strFromU8(z[rel] || new Uint8Array()),
        xml = strFromU8(z[part] || new Uint8Array());
      return media.some((m) => {
        const name = m.slice(5);
        const tags = rs.match(/<Relationship\b[^>]*\/?\s*>/g) || [];
        return tags.some((tag) => {
          const target = tag.match(/Target="([^"]+)"/)?.[1],
            id = tag.match(/Id="([^"]+)"/)?.[1];
          return target === name && id && xml.includes('r:embed="' + id + '"');
        });
      });
    }
    if (!every) return linked("word/document.xml");
    if (linked("word/document.xml")) return false;
    const doc = strFromU8(z["word/document.xml"]),
      rels = strFromU8(z["word/_rels/document.xml.rels"] || new Uint8Array());
    const sections = doc.match(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g) || [];
    if (!sections.length) return false;
    return sections.every((sec) =>
      ["default", "first", "even"].every((type) => {
        const ref = (sec.match(/<w:footerReference\b[^>]*\/?\s*>/g) || []).find((t) =>
          t.includes('w:type="' + type + '"'),
        );
        const id = ref?.match(/r:id="([^"]+)"/)?.[1];
        const tag = (rels.match(/<Relationship\b[^>]*\/?\s*>/g) || []).find((t) => t.includes('Id="' + id + '"'));
        const target = tag?.match(/Target="([^"]+)"/)?.[1];
        if (!target) return false;
        const part = "word/" + target;
        if (!linked(part)) return false;
        const px = strFromU8(z[part] || new Uint8Array()),
          pr = strFromU8(z["word/_rels/" + part.split("/").pop() + ".rels"] || new Uint8Array());
        const ids = (pr.match(/<Relationship\b[^>]*\/?\s*>/g) || [])
          .filter((t) => media.some((m) => t.includes('Target="' + m.slice(5) + '"')))
          .map((t) => t.match(/Id="([^\"]+)"/)?.[1])
          .filter(Boolean);
        const count = (px.match(/<w:drawing\b[^>]*>[\s\S]*?<\/w:drawing>/g) || []).filter((t) =>
          ids.some((id) => t.includes('r:embed="' + id + '"')),
        ).length;
        return count === 1 && footerMarkerCount(px) === 1;
      }),
    );
  }
  if (kind !== "pdf") return false;
  const signed = (await pdfSignedPages(await PDFDocument.load(bytes), c)).map(
    (b: number, n: number) => b === 1 || (b === 0 && c.visual_signed_pages?.includes(n + 1)),
  );
  return every ? signed.every(Boolean) : signed.some(Boolean);
}
async function record(q: any, d: any, result: any, state = "DONE") {
  check(
    await db
      .from("agenttender_go_workflow_events")
      .insert({
        tender_id: d.tender_id,
        event_type: "DOCUMENT_AUDIT_RESULT",
        details: { document_id: d.id, checklist_item_id: d.checklist_item_id, rule_version: RULE_VERSION, ...result },
      }),
  );
  if (q) {
    const mutation = db
      .from("agenttender_document_audit_queue")
      .update({
        state,
        classification: result.classification,
        source_hash: result.source_hash || null,
        output_hash: result.output_hash || null,
        result,
        last_error: result.error || null,
        leased_until: null,
        ready_at: new Date(Date.now() + Math.min(3600, 60 * 2 ** (q.attempts || 1)) * 1000).toISOString(),
        source_url: result.url || d.storage_url,
        rule_version: RULE_VERSION,
        updated_at: new Date().toISOString(),
      })
      .eq("document_id", d.id);
    check(
      await (result.url || d.storage_url
        ? mutation.eq("source_url", result.url || d.storage_url)
        : mutation.is("source_url", null)),
    );
  }
}
async function auditOne(d: any, q: any, input: any) {
  let sourceHash = "";
  try {
    if (d.is_placeholder || (!d.storage_url && !d.blob_name))
      throw Error("SOURCE_DOCUMENT_UNAVAILABLE: placeholder or missing file");
    const c = { ...(await config(d.company_id)) },
      bytes = await bytesFor(d, c);
    sourceHash = await sha(bytes);
    let i = check(
      await db
        .from("agenttender_bid_checklist_items")
        .select("*")
        .eq("matched_workspace_document_id", d.id)
        .eq("is_archived", false)
        .limit(1)
        .maybeSingle(),
    );
    if (!i && d.checklist_item_id)
      i = check(
        await db.from("agenttender_bid_checklist_items").select("*").eq("id", d.checklist_item_id).maybeSingle(),
      );
    if (i && !i.is_archived) d.checklist_item_id = i.id;
    const historical = !!(i?.matched_workspace_document_id && i.matched_workspace_document_id !== d.id);
    let review: any;
    try {
      review = await reviewDocument(db, { ...d, audit_historical: historical }, i, bytes, c);
    } catch (reviewError) {
      // A content review that cannot run (scanned file, too large, provider down, missing RFP clause)
      // must not leave the current checklist document unsigned. Sign it and report the review gap.
      const message = String((reviewError as any)?.message || reviewError);
      if (!i || i.is_archived || historical || /DIGITAL_SIGNATURE|password/i.test(message)) throw reviewError;
      const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const kind = isPdf ? "pdf" : isZip ? "docx" : "other";
      const pages = isPdf ? (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount() : undefined;
      review = {
        kind,
        pages,
        text: "",
        decision: {
          content_valid: false,
          required_signature: true,
          required_stamp: true,
          every_page: true,
          missing: ["Automatic content review unavailable: " + message.slice(0, 300)],
          unsupported_claims: [],
          reason: "Content review unavailable; document signed so the bid set is complete.",
        },
      };
    }
    const v = review.decision;
    if (i && !i.is_archived && !historical) {
      v.required_signature = true;
      v.required_stamp = true;
      v.every_page = true;
      v.self_attestation_permitted = true;
      v.signing_policy = "OWNER_APPROVED_EVERY_PAGE_20261026";
    }
    let classification = "SIGNING_NOT_REQUIRED",
      error: string | null = null;
    // Owner rule (2026-10-28): every current checklist document is signed and stamped on every page.
    // Content/format findings are reported on the checklist item but never stop the signing.
    let contentIssue: string | null = null,
      contentClass: string | null = null;
    const executionPending = v.requires_dsc ? "DIGITAL_SIGNATURE_REQUIRED" : null;
    if (v.independent_certification_missing) {
      contentClass = "CONTENT_REPAIR_REQUIRED";
      contentIssue = "Independent issuer/notary certification is required.";
    } else if (!v.content_valid) {
      contentClass = "CONTENT_REPAIR_REQUIRED";
      contentIssue = JSON.stringify({ missing: v.missing, unsupported: v.unsupported_claims, reason: v.reason });
    } else if (v.required_format && v.required_format !== review.kind) {
      contentClass = "CONTENT_REPAIR_REQUIRED";
      contentIssue = "FORMAT_REPAIR_REQUIRED: expected " + v.required_format + ", actual " + review.kind;
    }
    const required = v.required_signature || v.required_stamp;
    let present = required ? await signaturePresent(bytes, c, review.kind, !!v.every_page) : false;
    let visual: any = null;
    if (
      !error &&
      required &&
      !present &&
      review.kind === "pdf" &&
      !(await pdfSignedPages(await PDFDocument.load(bytes), c)).some((n: number) => n > 1)
    ) {
      try {
        visual = await inspectVisualSignature(db, d, bytes, c, sourceHash);
      } catch (visualError) {
        // Vision review unavailable (quota/timeout): rely on the structural check of the approved image.
        visual = { pages: [], unavailable: String((visualError as any)?.message || visualError) };
      }
      const checked = visual.pages.filter(
        (p: any) => p.approved_signature_and_seal_present && p.approved_asset_count === 1 && p.confidence >= 0.95,
      );
      present = visual.unavailable
        ? false
        : v.every_page
          ? checked.length === review.pages
          : checked.length > 0;
      c.visual_signed_pages = checked.map((p: any) => p.page);
      if (!present && visual.pages.some((p: any) => p.uncertain_bidder_signature || p.confidence < 0.95))
        error = "SIGNATURE_PRESENCE_UNCERTAIN: preserve source and avoid duplicate signing";
      if (visual.pages.some((p: any) => p.approved_asset_count > 1))
        error = "FLATTENED_DUPLICATE_SIGNATURE_REPAIR_REQUIRES_ORIGINAL: preserve source; do not add another image";
      if (visual.pages.some((p: any) => !p.readable)) error = "SOURCE_VISUAL_READABILITY_FAILED";
    }
    if (error && classification === "SIGNING_NOT_REQUIRED") classification = "SIGNING_FAILED";
    if (required && !present && !["pdf", "docx"].includes(review.kind) && !error)
      error = "UNSUPPORTED_SIGNING_FORMAT: " + review.kind;
    if (!error && required && present) classification = "SIGNED_AND_VERIFIED";
    if (!error && required && !present) {
      classification =
        v.required_signature && v.required_stamp
          ? "BOTH_MISSING"
          : v.required_signature
            ? "SIGNATURE_MISSING"
            : "STAMP_MISSING";
      if (i?.processing_type === "COMPANY_DOC" && (!c.cfg.apply_to_company_documents || !v.self_attestation_permitted))
        error =
          "SIGNING_NOT_AUTHORIZED: RFP does not permit bidder self-attestation of this original company evidence.";
      if (i?.processing_type !== "COMPANY_DOC" && !c.cfg.apply_to_ai_generated_documents)
        error = "SIGNING_NOT_AUTHORIZED_FOR_AI_DRAFT";
      if (v.required_stamp && c.cfg.include_company_stamp !== true) error = "APPROVED_COMPANY_STAMP_UNAVAILABLE";
      if (!c.profile.authorized_signatory_name || !c.profile.authorized_signatory_designation)
        error = "VERIFIED_SIGNATORY_DETAILS_UNAVAILABLE";
    }
    const baseResult: any = {
      external_execution_pending: executionPending,
      visual_signature_review: visual,
      document_id: d.id,
      file: d.file_name,
      classification,
      source_hash: sourceHash,
      content_review: v,
      already_signed: present,
      actual_format: review.kind,
      pages: review.pages,
      signature_every_page: !!v.every_page,
      signature_asset_hash: c.imageHash,
      signing_required: required,
      source_url: d.storage_url,
      content_issue: contentIssue,
    };
    if (input.dry_run) return { ...baseResult, error };
    if (error) {
      if (i && !i.is_archived && !historical)
        check(
          await db
            .from("agenttender_bid_checklist_items")
            .update({
              completion_status: "ACTION_REQUIRED",
              evidence_review_status: classification,
              automation_last_error: error,
              updated_at: new Date().toISOString(),
            })
            .eq("id", i.id),
        );
      await record(q, d, { ...baseResult, error }, "EXCEPTION");
      return { ...baseResult, error };
    }
    if (!required || present) {
      const linked = await readSource(
        db,
        { ...d, blob_name: null, storage_blob_name: null },
        c.cfg.asset_image_drive_id,
      );
      if ((await sha(linked)) !== sourceHash) throw Error("CURRENT_DOCUMENT_LINK_HASH_MISMATCH");
      if (i && !i.is_archived && !historical)
        check(
          await db
            .from("agenttender_bid_checklist_items")
            .update({
              matched_workspace_document_id: d.id,
              completion_status:
                executionPending || contentIssue
                  ? "ACTION_REQUIRED"
                  : i.processing_type === "COMPANY_DOC"
                    ? "COMPLETED_COMPANY_DOCUMENT"
                    : "COMPLETED_TENDER_DOCUMENT",
              evidence_review_status: contentClass || executionPending || classification,
              automation_last_error: contentIssue
                ? contentIssue
                : executionPending
                  ? "Every-page image attestation does not replace portal/DSC execution."
                  : null,
              evidence_reviewed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", i.id),
        );
      await record(
        q,
        d,
        {
          ...baseResult,
          classification: executionPending || classification,
          error: executionPending,
          output_hash: sourceHash,
          modified: false,
          download_verified: true,
          link_verified: true,
        },
        executionPending ? "EXCEPTION" : "DONE",
      );
      return { ...baseResult, classification: executionPending || classification, modified: false };
    }
    if (
      review.kind === "pdf" &&
      v.signature_location &&
      !/footer|bottom|end of|last page|submission copy/i.test(v.signature_location)
    )
      // The every-page footer signature is still applied; flag the designated spot for a person.
      contentIssue =
        (contentIssue ? contentIssue + " | " : "") +
        "Also sign at the designated place: " +
        String(v.signature_location).slice(0, 200);
    if (contentIssue && !contentClass) contentClass = "SIGNED_PLACEMENT_REVIEW";
    const output =
      review.kind === "pdf" ? await patchPdf(bytes, c, !!v.every_page) : patchDocx(bytes, c, !!v.every_page);
    const reopenedText = await actualText(output.bytes);
    const words = (x: string) => x.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const available = new Map<string, number>();
    for (const word of words(reopenedText.text)) available.set(word, (available.get(word) || 0) + 1);
    const sourceNative = await nativeText(bytes);
    for (const word of words(sourceNative.text)) {
      const count = available.get(word) || 0;
      if (!count) throw Error("SIGNED_OUTPUT_CONTENT_LOSS_DETECTED");
      available.set(word, count - 1);
    }
    if (review.pages && reopenedText.pages !== review.pages) throw Error("SIGNED_OUTPUT_PAGE_COUNT_CHANGED");
    if (!(await signaturePresent(output.bytes, c, output.kind, !!v.every_page)))
      throw Error("SAVED_SIGNATURE_OR_STAMP_VERIFICATION_FAILED");
    const suffix = output.kind === "pdf" ? ".pdf" : ".docx",
      file =
        String(d.file_name || d.title || "document").replace(/(?:-signed)*\.(pdf|docx)$/i, "") + "-signed" + suffix;
    const path = d.tender_id + "/" + d.id + "/signed-v4-" + crypto.randomUUID() + suffix,
      mime =
        output.kind === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    check(
      await db.storage.from("agenttender-bid-drafts").upload(path, output.bytes, { contentType: mime, upsert: false }),
    );
    const saved = check(await db.storage.from("agenttender-bid-drafts").download(path)),
      savedBytes = new Uint8Array(await saved.arrayBuffer()),
      hash = await sha(output.bytes);
    if ((await sha(savedBytes)) !== hash || !(await signaturePresent(savedBytes, c, output.kind, !!v.every_page)))
      throw Error("SAVED_FILE_HASH_OR_SIGNATURE_MISMATCH");
    const link = await downloadUrl(path, file),
      linkCheck = await fetch(link, { signal: AbortSignal.timeout(30000) });
    if (!linkCheck.ok || (await sha(new Uint8Array(await linkCheck.arrayBuffer()))) !== hash)
      throw Error("SIGNED_DOCUMENT_LINK_VERIFICATION_FAILED");
    check(
      await db
        .from("agenttender_go_workflow_events")
        .insert({
          tender_id: d.tender_id,
          event_type: "DOCUMENT_SIGNING_REPAIRED",
          details: {
            document_id: d.id,
            checklist_item_id: d.checklist_item_id,
            before: d,
            new_blob_name: path,
            new_storage_url: link,
            source_hash: sourceHash,
            signed_file_sha256: hash,
            signature_asset_sha256: c.imageHash,
            original_preserved: true,
            storage_download_verified: true,
            link_verified: true,
            rule_version: RULE_VERSION,
          },
        }),
    );
    check(
      await db
        .from("agenttender_bid_workspace_documents")
        .update({
          file_name: file,
          mime_type: mime,
          file_size_bytes: savedBytes.length,
          blob_name: path,
          storage_url: link,
          status: "ready",
          version_label: "VBDC_SIGN_V4 " + hash,
          updated_at: new Date().toISOString(),
        })
        .eq("id", d.id)
        .eq("storage_url", d.storage_url)
        .select("id")
        .single(),
    );
    const chunks = check(
      await db
        .from("agenttender_ai_document_chunks")
        .select("id,metadata")
        .eq("source_type", "GENERATED_BID_DOCUMENT")
        .eq("source_id", d.id)
        .eq("is_active", true),
    );
    for (const chunk of chunks || [])
      check(
        await db
          .from("agenttender_ai_document_chunks")
          .update({
            document_url: link,
            metadata: {
              ...chunk.metadata,
              signature_applied: true,
              stamp_applied: c.cfg.include_company_stamp === true,
              signature_every_page: !!v.every_page,
              signature_rule_version: RULE_VERSION,
              signature_asset_sha256: c.imageHash,
              signed_file_sha256: hash,
            },
          })
          .eq("id", chunk.id),
      );
    if (i && !i.is_archived && !historical)
      check(
        await db
          .from("agenttender_bid_checklist_items")
          .update({
            matched_workspace_document_id: d.id,
            completion_status:
              executionPending || contentIssue
                ? "ACTION_REQUIRED"
                : i.processing_type === "COMPANY_DOC"
                  ? "COMPLETED_COMPANY_DOCUMENT"
                  : "COMPLETED_TENDER_DOCUMENT",
            evidence_review_status: contentClass || executionPending || "SIGNED_AND_VERIFIED",
            automation_last_error: contentIssue
              ? contentIssue
              : executionPending
                ? "Every-page image attestation does not replace portal/DSC execution."
                : null,
            evidence_reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", i.id),
      );
    const result = {
      ...baseResult,
      classification: executionPending || "SIGNED_AND_VERIFIED",
      error: executionPending,
      image_signature_verified: true,
      modified: true,
      output_hash: hash,
      url: link,
      download_verified: true,
      link_verified: true,
    };
    await record(q, d, result, executionPending ? "EXCEPTION" : "DONE");
    return result;
  } catch (e) {
    const error = String((e as any)?.message || e),
      classification = /SOURCE_DOCUMENT|SOURCE_DOWNLOAD|STORAGE_SOURCE/.test(error)
        ? "SOURCE_DOCUMENT_UNAVAILABLE"
        : /DIGITAL_SIGNATURE/.test(error)
          ? "DIGITAL_SIGNATURE_REQUIRED"
          : "SIGNING_FAILED";
    const result = { document_id: d.id, file: d.file_name, classification, error, source_hash: sourceHash };
    if (!input.dry_run) {
      if (d.checklist_item_id)
        check(
          await db
            .from("agenttender_bid_checklist_items")
            .update({
              completion_status: "ACTION_REQUIRED",
              evidence_review_status: classification,
              automation_last_error: error,
              updated_at: new Date().toISOString(),
            })
            .eq("id", d.checklist_item_id)
            .eq("is_archived", false)
            .eq("matched_workspace_document_id", d.id),
        );
      await record(
        q,
        d,
        result,
        !/credit_balance_exhausted|insufficient_quota/.test(error) &&
          (/OCR_PENDING|VISUAL_REVIEW_PENDING/.test(error) ||
            (q && q.attempts < 5 && /HTTP_5|HTTP 5|HTTP_429|HTTP 429|timeout|timed out|429|network|fetch/i.test(error)))
          ? "RETRY"
          : "EXCEPTION",
      );
    }
    return result;
  }
}
Deno.serve(async (req) => {
  if (req.method !== "POST" || !key || req.headers.get("Authorization") !== "Bearer " + key)
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const input = await req.json().catch(() => ({})),
      limit = Math.max(1, Math.min(8, Number(input.limit) || 2));
    const ts = check(
      await db.from("agenttender_tenders").select("id,source_tender_id").eq("qualification_status", "GO"),
    );
    const ids = ts
      .filter((t: any) => !input.tender_id || String(t.source_tender_id) === String(input.tender_id))
      .map((t: any) => t.id);
    if (!ids.length) return Response.json({ ok: true, results: [] });
    if (input.action === "asset_preview") {
      const c = await config("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      let binary = "";
      for (let n = 0; n < c.image.length; n += 16384) binary += String.fromCharCode(...c.image.slice(n, n + 16384));
      return Response.json({ ok: true, image_base64: btoa(binary), sha256: c.imageHash });
    }
    if (input.document_id) {
      const d = check(
        await db
          .from("agenttender_bid_workspace_documents")
          .select("*")
          .eq("id", input.document_id)
          .in("tender_id", ids)
          .single(),
      );
      if (input.action === "file_preview") {
        if (d.is_placeholder || (!d.storage_url && !d.blob_name))
          throw Error("SOURCE_DOCUMENT_UNAVAILABLE: placeholder or missing file");
        const c = { ...(await config(d.company_id)) },
          bytes = await bytesFor(d, c);
        let binary = "";
        for (let n = 0; n < bytes.length; n += 16384) binary += String.fromCharCode(...bytes.slice(n, n + 16384));
        return Response.json({ ok: true, file_name: d.file_name, sha256: await sha(bytes), file_base64: btoa(binary) });
      }
      if (input.dry_run) return Response.json({ ok: true, results: [await auditOne(d, null, input)] });
      check(
        await db
          .from("agenttender_document_audit_queue")
          .upsert(
            {
              document_id: d.id,
              tender_id: d.tender_id,
              workspace_id: d.workspace_id,
              checklist_item_id: d.checklist_item_id,
              source_url: d.storage_url,
            },
            { onConflict: "document_id", ignoreDuplicates: true },
          ),
      );
      const current = check(
        await db.from("agenttender_document_audit_queue").select("*").eq("document_id", d.id).single(),
      );
      if (current.state === "RUNNING" && new Date(current.leased_until).getTime() > Date.now())
        return Response.json({ ok: true, results: [{ document_id: d.id, skipped: true, reason: "LEASED" }] });
      const claim = check(
        await db
          .from("agenttender_document_audit_queue")
          .update({
            state: "RUNNING",
            attempts: current.attempts + 1,
            leased_until: new Date(Date.now() + 240000).toISOString(),
          })
          .eq("document_id", d.id)
          .eq("state", current.state)
          .eq("attempts", current.attempts)
          .select()
          .maybeSingle(),
      );
      return Response.json({
        ok: true,
        results: [claim ? await auditOne(d, claim, input) : { document_id: d.id, skipped: true }],
      });
    }
    check(
      await db
        .from("agenttender_document_audit_queue")
        .update({
          state: "RETRY",
          leased_until: null,
          ready_at: new Date().toISOString(),
          last_error: "Expired document lease recovered",
        })
        .eq("state", "RUNNING")
        .lt("leased_until", new Date().toISOString()),
    );
    const candidates = check(await db.rpc("agenttender_claim_document_audits", { p_tender_ids: ids, p_limit: limit }));
    const work = Promise.all(
      candidates.map(async (q: any) => {
        const claim = q;
        try {
          const d = check(
            await db.from("agenttender_bid_workspace_documents").select("*").eq("id", q.document_id).single(),
          );
          return await auditOne(d, claim, input);
        } catch (e) {
          const error = String((e as any)?.message || e);
          check(
            await db
              .from("agenttender_document_audit_queue")
              .update({
                state: "EXCEPTION",
                classification: "SOURCE_DOCUMENT_UNAVAILABLE",
                last_error: error,
                leased_until: null,
              })
              .eq("document_id", q.document_id)
              .eq("attempts", claim.attempts),
          );
          return { document_id: q.document_id, error };
        }
      }),
    );
    if (input.background === true) {
      EdgeRuntime.waitUntil(work);
      return Response.json({ ok: true, accepted: true, claimed: candidates.map((q: any) => q.document_id) });
    }
    const results = await work;
    return Response.json({ ok: true, processed: results.length, results });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as any)?.message || e) }, { status: 500 });
  }
});
