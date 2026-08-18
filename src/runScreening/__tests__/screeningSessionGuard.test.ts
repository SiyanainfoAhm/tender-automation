import assert from "node:assert/strict";
import test from "node:test";
import { AutomationError } from "../../browserUtils.js";
import {
  assertChatGptScreeningSafeToClose,
  isChatGptScreeningSafeToClose,
} from "../screeningSessionGuard.js";
import { resolveRunScreeningResponseTimeoutMs } from "../chatgptExcelScreening.js";

test("refuses to close ChatGPT after submit until the generated workbook is downloaded", () => {
  assert.throws(
    () =>
      assertChatGptScreeningSafeToClose({
        submitted: true,
        downloaded: false,
        explicitTerminalFailure: false,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AutomationError);
      assert.equal(error.code, "REFUSING_TO_CLOSE_CHATGPT_SCREENING");
      return true;
    },
  );
  assert.equal(
    isChatGptScreeningSafeToClose({
      submitted: true,
      downloaded: false,
      explicitTerminalFailure: false,
    }),
    false,
  );
});

test("allows close after download or explicit terminal failure", () => {
  assertChatGptScreeningSafeToClose({
    submitted: true,
    downloaded: true,
    validated: true,
    explicitTerminalFailure: false,
  });
  assertChatGptScreeningSafeToClose({
    submitted: true,
    downloaded: false,
    explicitTerminalFailure: true,
  });
  assertChatGptScreeningSafeToClose({
    submitted: false,
    downloaded: false,
    explicitTerminalFailure: false,
  });
  assert.equal(
    isChatGptScreeningSafeToClose({
      submitted: true,
      downloaded: true,
      explicitTerminalFailure: false,
    }),
    true,
  );
});

test("run-screening response timeout defaults to 10 minutes", () => {
  assert.equal(resolveRunScreeningResponseTimeoutMs({}), 600_000);
  assert.equal(
    resolveRunScreeningResponseTimeoutMs({
      CHATGPT_RUN_SCREENING_RESPONSE_TIMEOUT_MS: "600000",
    }),
    600_000,
  );
});
