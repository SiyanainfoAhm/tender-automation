import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("Global download path logs success and classified failures", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tender247Batch/downloadRequiredTenderFiles.ts"),
    "utf8",
  );
  assert.match(src, /GLOBAL_DOWNLOAD_START/);
  assert.match(src, /GLOBAL_DOWNLOAD_BUTTON_FOUND/);
  assert.match(src, /GLOBAL_DOWNLOAD_SUCCESS/);
  assert.match(src, /GLOBAL_DOWNLOAD_FAILED/);
  assert.match(src, /GLOBAL_DOCUMENT_NOT_AVAILABLE/);
  assert.match(src, /DOCUMENT_NOT_AVAILABLE/);
  assert.match(src, /advance to next tender/);
  assert.match(src, /T247_DOCUMENTS_TERMINAL_UNAVAILABLE/);
  assert.match(src, /probeTenderDocumentListCount/);
  assert.match(src, /capturePortalFailures/);
  assert.match(src, /T247_DOCUMENT_LIST_EMPTY_HINT/);
  assert.match(src, /still attempting Download All via UI/);
  assert.doesNotMatch(
    src,
    /reason=document_list_empty[\s\S]{0,120}failureKind:\s*"DOCUMENT_NOT_AVAILABLE"/,
  );
});

test("downloadHelpers emits GLOBAL_DOWNLOAD_CLICKED and network capture", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tenderDetails/downloadHelpers.ts"),
    "utf8",
  );
  assert.match(src, /GLOBAL_DOWNLOAD_CLICKED/);
  assert.match(src, /GLOBAL_DOWNLOAD_REQUEST/);
  assert.match(src, /DOWNLOAD_PORTAL_ALERT/);
  assert.match(src, /classifyDocumentDownloadFailure/);
  assert.match(src, /DOWNLOAD_EVENT_RECEIVED/);
  assert.match(src, /DOWNLOAD_SAVE_DONE/);
  assert.match(src, /shouldAbort/);
});

test("processTender skips final gate when documents unavailable", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tender247Batch/processTender.ts"),
    "utf8",
  );
  assert.match(src, /FINAL_GATE_SKIPPED_DOCUMENTS_UNAVAILABLE/);
  assert.match(src, /STATUS=DOCUMENTS_UNAVAILABLE/);
});
