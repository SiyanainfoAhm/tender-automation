import assert from "node:assert/strict";
import test from "node:test";
import { classifyDocumentDownloadFailure } from "../downloadHelpers.js";
import { parseTender247DetailRoute } from "../../tender247/sourceRegion.js";

test("classifyDocumentDownloadFailure maps portal alert and empty docs", () => {
  assert.equal(
    classifyDocumentDownloadFailure({
      portalAlert: "Failed to download file. Please try again.",
    }),
    "PORTAL_ALERT",
  );
  assert.equal(
    classifyDocumentDownloadFailure({
      portalAlert: "Failed to download file. Please try again.",
      responseStatus: 500,
      downloadEndpoint:
        "https://www.tender247.com/downloaddocument/global-tender/download-document-all/abc",
    }),
    "DOCUMENT_NOT_AVAILABLE",
  );
  assert.equal(
    classifyDocumentDownloadFailure({
      responseStatus: 500,
      downloadEndpoint:
        "https://www.tender247.com/downloaddocument/global-tender/download-document-all/abc",
      error: "No download event, popup, or file response detected after click",
    }),
    "DOCUMENT_NOT_AVAILABLE",
  );
  assert.equal(
    classifyDocumentDownloadFailure({
      error: "No documents available for this tender",
    }),
    "DOCUMENT_NOT_AVAILABLE",
  );
  assert.equal(
    classifyDocumentDownloadFailure({
      responseStatus: 401,
      error: "forbidden",
    }),
    "AUTH_SESSION",
  );
  assert.equal(
    classifyDocumentDownloadFailure({
      error: "No download event, popup, or file response detected after click",
    }),
    "NO_DOWNLOAD_EVENT",
  );
  assert.equal(
    classifyDocumentDownloadFailure({
      error: "DOWNLOADED_FILE_EMPTY",
    }),
    "EMPTY_FILE",
  );
});

test("parseTender247DetailRoute requires id and uuid for Global and Indian", () => {
  assert.deepEqual(
    parseTender247DetailRoute(
      "https://www.tender247.com/auth/globaltender/104294221/abc-def-12345678",
    ),
    {
      region: "GLOBAL",
      tenderId: "104294221",
      securityCode: "abc-def-12345678",
    },
  );
  assert.deepEqual(
    parseTender247DetailRoute(
      "https://www.tender247.com/auth/tender/104294221/abc-def-12345678",
    ),
    {
      region: "INDIAN",
      tenderId: "104294221",
      securityCode: "abc-def-12345678",
    },
  );
  assert.equal(
    parseTender247DetailRoute(
      "https://www.tender247.com/auth/globaltender/104294221",
    ),
    null,
  );
});
