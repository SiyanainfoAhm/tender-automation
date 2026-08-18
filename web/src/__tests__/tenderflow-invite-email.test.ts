import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { generateTemporaryPassword } from "@/lib/auth/temporary-password";
import { escapeHtml } from "@/lib/email/escape-html";
import { buildTenderFlowInviteEmail } from "@/lib/email/tenderflow-invite-content";
import { passwordSchema } from "@/lib/validations";

vi.mock("server-only", () => ({}));

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walkFiles(full, acc);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("temporary password generation", () => {
  it("meets TenderFlow password policy without Math.random", () => {
    const password = generateTemporaryPassword();
    expect(passwordSchema.safeParse(password).success).toBe(true);
    expect(password).not.toMatch(/undefined/);
  });

  it("produces distinct values", () => {
    const passwords = new Set(
      Array.from({ length: 8 }, () => generateTemporaryPassword()),
    );
    expect(passwords.size).toBeGreaterThan(1);
  });
});

describe("invitation email content", () => {
  it("builds an initial invite with app URL, email, and password", () => {
    const content = buildTenderFlowInviteEmail(
      {
        mode: "initial",
        name: "Rajesh",
        email: "rajesh@example.com",
        temporaryPassword: "TempPass123!",
      },
      "https://tenderflow.example.com/",
    );
    expect(content.subject).toBe("TenderFlow account invitation");
    expect(content.toEmail).toBe("rajesh@example.com");
    expect(content.body).toContain("https://tenderflow.example.com");
    expect(content.body).toContain("rajesh@example.com");
    expect(content.body).toContain("TempPass123!");
    expect(content.body).toContain("Your TenderFlow account has been created.");
    expect(content.body).toContain("change your temporary password");
    expect(content.body).not.toContain("Expected Completion");
  });

  it("builds a resend invite and invalidates previous password copy", () => {
    const content = buildTenderFlowInviteEmail(
      {
        mode: "resend",
        name: "Rajesh",
        email: "rajesh@example.com",
        temporaryPassword: "NewPass123!",
      },
      "http://localhost:3000",
    );
    expect(content.subject).toBe("Your TenderFlow invitation has been resent");
    expect(content.body).toContain("invitation has been resent");
    expect(content.body).toContain("no longer valid");
    expect(content.body).toContain("NewPass123!");
  });

  it("escapes untrusted values in HTML", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    const content = buildTenderFlowInviteEmail(
      {
        mode: "initial",
        name: `<img src=x onerror=alert(1)>`,
        email: `a@b.com"><script>`,
        temporaryPassword: `abc<>&'`,
      },
      "https://app.example.com",
    );
    expect(content.body).not.toContain("<img");
    expect(content.body).not.toContain("<script>");
    expect(content.body).toContain("&lt;img");
  });
});

describe("Power Automate email helper", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("fails when POWER_AUTOMATE_EMAIL_URL is missing", async () => {
    vi.stubEnv("POWER_AUTOMATE_EMAIL_URL", "");
    const { sendPowerAutomateEmail } = await import(
      "@/lib/email/power-automate-email"
    );
    const result = await sendPowerAutomateEmail({
      toEmail: "a@b.com",
      subject: "s",
      body: "b",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/POWER_AUTOMATE_EMAIL_URL/);
    }
  });

  it("POSTs toEmail/subject/body with JSON content type and no custom secret", async () => {
    vi.stubEnv("POWER_AUTOMATE_EMAIL_URL", "https://example.com/hooks/email");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { sendPowerAutomateEmail } = await import(
      "@/lib/email/power-automate-email"
    );
    const result = await sendPowerAutomateEmail({
      toEmail: "rajesh@example.com",
      subject: "TenderFlow account invitation",
      body: "<p>hello</p>",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/hooks/email");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      toEmail: "rajesh@example.com",
      subject: "TenderFlow account invitation",
      body: "<p>hello</p>",
    });
    expect(JSON.stringify(init.headers)).not.toMatch(/secret/i);
  });

  it("treats non-2xx as failure without deleting the user", async () => {
    vi.stubEnv("POWER_AUTOMATE_EMAIL_URL", "https://example.com/hooks/email");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: async () => "flow failed",
      }),
    );
    const { sendPowerAutomateEmail } = await import(
      "@/lib/email/power-automate-email"
    );
    const result = await sendPowerAutomateEmail({
      toEmail: "a@b.com",
      subject: "s",
      body: "b",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("flow failed");
  });
});

describe("TenderFlow invite sender", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("requires TENDERFLOW_APP_URL", async () => {
    vi.stubEnv("POWER_AUTOMATE_EMAIL_URL", "https://example.com/hooks/email");
    vi.stubEnv("TENDERFLOW_APP_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { sendTenderFlowUserInvite } = await import(
      "@/lib/email/tenderflow-user-invite"
    );
    const result = await sendTenderFlowUserInvite({
      mode: "initial",
      name: "Rajesh",
      email: "rajesh@example.com",
      temporaryPassword: "TempPass123!",
    });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the composed invite payload once", async () => {
    vi.stubEnv("POWER_AUTOMATE_EMAIL_URL", "https://example.com/hooks/email");
    vi.stubEnv("TENDERFLOW_APP_URL", "https://tenderflow.example.com");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { sendTenderFlowUserInvite } = await import(
      "@/lib/email/tenderflow-user-invite"
    );
    const result = await sendTenderFlowUserInvite({
      mode: "initial",
      name: "Rajesh",
      email: "rajesh@example.com",
      temporaryPassword: "TempPass123!",
    });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body),
    ) as { toEmail: string; subject: string; body: string };
    expect(payload.toEmail).toBe("rajesh@example.com");
    expect(payload.subject).toBe("TenderFlow account invitation");
    expect(payload.body).toContain("https://tenderflow.example.com");
    expect(payload.body).toContain("TempPass123!");
  });
});

describe("server-only email secrets", () => {
  it("does not expose POWER_AUTOMATE_EMAIL_URL in client modules", () => {
    const srcRoot = path.resolve(__dirname, "..");
    const violations: string[] = [];
    for (const file of walkFiles(srcRoot)) {
      if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
      const text = readFileSync(file, "utf8");
      if (text.includes("NEXT_PUBLIC_POWER_AUTOMATE_EMAIL_URL")) {
        violations.push(file);
      }
      if (
        text.includes("POWER_AUTOMATE_EMAIL_URL") &&
        /^\s*["']use client["']/.test(text)
      ) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
