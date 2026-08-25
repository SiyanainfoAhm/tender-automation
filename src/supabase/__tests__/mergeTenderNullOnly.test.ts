import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  isBlankDbValue,
  mergeNullOnlyRecord,
} from "../mergeTenderNullOnly.js";
import {
  buildTenderArtifactBlobName,
  resolveLocalArtifactPath,
} from "../tenderArtifactUpload.js";

describe("mergeNullOnlyRecord", () => {
  it("fills blank fields only", () => {
    const existing: {
      title: string | null;
      emd_text: string | null;
      organization: string | null;
      location_text?: string | null;
    } = { title: "Existing", emd_text: null, organization: "" };

    const { next, updatedKeys } = mergeNullOnlyRecord(existing, {
      title: "From GPT",
      emd_text: "150000",
      organization: "Org",
      location_text: "Delhi",
    });
    assert.deepEqual(next, {
      emd_text: "150000",
      organization: "Org",
      location_text: "Delhi",
    });
    assert.ok(updatedKeys.includes("emd_text"));
    assert.ok(!updatedKeys.includes("title"));
  });

  it("always updates listed keys", () => {
    const existing: {
      qualification_status: string | null;
      title: string | null;
    } = { qualification_status: "VERIFY", title: "A" };

    const { next } = mergeNullOnlyRecord(
      existing,
      { qualification_status: "GO", title: "B" },
      ["qualification_status"],
    );
    assert.equal(next.qualification_status, "GO");
    assert.equal(next.title, undefined);
  });

  it("isBlankDbValue treats empty string as blank", () => {
    assert.equal(isBlankDbValue(""), true);
    assert.equal(isBlankDbValue("x"), false);
  });
});

describe("buildTenderArtifactBlobName", () => {
  it("builds a stable tender artifact path", () => {
    assert.equal(
      buildTenderArtifactBlobName({
        sourcePortal: "TENDER247",
        sourceTenderId: "103389190",
        runDate: "2026-08-18",
        fileName: "Tender_All_Documents.zip",
      }),
      "companies/siyana/tender-artifacts/tender247/2026-08-18/103389190/tender-all-documents.zip",
    );
  });

  it("builds manual portal path under tender-artifacts/manual", () => {
    assert.equal(
      buildTenderArtifactBlobName({
        sourcePortal: "MANUAL",
        sourceTenderId: "MAN-55AF81E6E54B",
        runDate: "2026-08-25",
        fileName: "scope.pdf",
      }),
      "companies/siyana/tender-artifacts/manual/2026-08-25/MAN-55AF81E6E54B/scope.pdf",
    );
  });
});

describe("resolveLocalArtifactPath", () => {
  it("finds documents zip under documents/", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-path-"));
    const docs = path.join(root, "documents");
    fs.mkdirSync(docs);
    const zipPath = path.join(docs, "Tender_All_Documents.zip");
    fs.writeFileSync(zipPath, "zip-bytes");
    assert.equal(resolveLocalArtifactPath(root, "documents_zip"), zipPath);
    assert.equal(resolveLocalArtifactPath(root, "ai_summary"), null);
    fs.writeFileSync(path.join(root, "AI_Summary.pdf"), "%PDF-1.4 test content here");
    assert.ok(resolveLocalArtifactPath(root, "ai_summary")?.endsWith("AI_Summary.pdf"));
  });
});
