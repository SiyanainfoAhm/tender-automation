import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildAccountLogPrefix,
  normalizeEnvTender247AccountSlot,
  resolveTender247AccountAuthPaths,
  resolveTender247RunAccount,
} from "../tender247Accounts.js";

describe("tender247 multi-account isolation", () => {
  it("uses company/account-scoped auth paths", () => {
    const a = resolveTender247AccountAuthPaths({
      companyId: "company-1",
      accountId: "account-1",
    });
    const b = resolveTender247AccountAuthPaths({
      companyId: "company-1",
      accountId: "account-2",
    });
    assert.match(a.storageStatePath, /auth[\\/]tender247[\\/]company-company-1[\\/]account-account-1[\\/]storage-state\.json$/);
    assert.match(a.profileDir, /account-account-1[\\/]profile$/);
    assert.notEqual(a.storageStatePath, b.storageStatePath);
    assert.notEqual(a.profileDir, b.profileDir);
  });

  it("builds SIYANA + account log prefix", () => {
    assert.equal(
      buildAccountLogPrefix({ companyLabel: "SIYANA", accountShort: "1a2b3c4d" }),
      "[SIYANA][T247_ACCOUNT=1a2b3c4d]",
    );
  });

  it("keeps seed excel under accounts/{id}", () => {
    const accountId = "11111111-2222-3333-4444-555555555555";
    const seed = path.join("accounts", accountId);
    assert.equal(seed, `accounts${path.sep}${accountId}`);
  });

  it("normalizes env account slots", () => {
    assert.equal(normalizeEnvTender247AccountSlot("1"), "1");
    assert.equal(normalizeEnvTender247AccountSlot("backup"), "2");
    assert.equal(normalizeEnvTender247AccountSlot("uuid-here"), null);
  });

  it("resolves env account 1 and 2 without DB", async () => {
    process.env.TENDER247_ACCOUNT_1_EMAIL = "main@example.com";
    process.env.TENDER247_ACCOUNT_1_PASSWORD = "main-pass";
    process.env.TENDER247_ACCOUNT_2_EMAIL = "backup@example.com";
    process.env.TENDER247_ACCOUNT_2_PASSWORD = "backup-pass";

    const a1 = await resolveTender247RunAccount({ accountId: "1" });
    const a2 = await resolveTender247RunAccount({ accountId: "2" });
    assert.equal(a1.accountId, "env-1");
    assert.equal(a1.username, "main@example.com");
    assert.equal(a2.accountId, "env-2");
    assert.equal(a2.username, "backup@example.com");
    assert.notEqual(a1.storageStatePath, a2.storageStatePath);
    assert.equal(a1.seedExcelSubdir, path.join("accounts", "env-1"));
    assert.equal(a2.seedExcelSubdir, path.join("accounts", "env-2"));
  });

  it("lists configured env account slots in order", async () => {
    const { listConfiguredEnvTender247AccountSlots } = await import(
      "../tender247Accounts.js"
    );
    const slots = listConfiguredEnvTender247AccountSlots({
      TENDER247_ACCOUNT_1_EMAIL: "a@x.com",
      TENDER247_ACCOUNT_1_PASSWORD: "p1",
      TENDER247_ACCOUNT_2_EMAIL: "b@x.com",
      TENDER247_ACCOUNT_2_PASSWORD: "p2",
    });
    assert.deepEqual(slots, ["1", "2"]);
    assert.deepEqual(
      listConfiguredEnvTender247AccountSlots({
        TENDER247_EMAIL: "only@x.com",
        TENDER247_PASSWORD: "p",
      }),
      ["1"],
    );
  });
});
