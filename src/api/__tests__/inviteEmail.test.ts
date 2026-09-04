/**
 * inviteEmail.test.ts — SecureLogic sends the invitation itself (goal §B).
 *
 * Pure content: the default message, the rendered email, escaping, the flag,
 * and the transport result mapping. The transport is mocked — the shared
 * mailer has its own suites; what matters here is that the invite path calls
 * it with the right purpose/correlation and tells the truth about the result.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSendEmail } = vi.hoisted(() => ({ mockSendEmail: vi.fn() }));
vi.mock("../infra/email.js", () => ({ sendEmail: mockSendEmail }));
vi.mock("../infra/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  buildPortalAcceptUrl,
  buildVendorInviteEmail,
  defaultInviteMessage,
  inviteEmailEnabled,
  sendVendorInviteEmail,
  VENDOR_INVITE_EMAIL_PURPOSE,
} from "../lib/vendorPortal/inviteEmail.js";

const TOKEN = "a".repeat(64);
const BASE = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  inviteId: "22222222-2222-4222-8222-222222222222",
  contactEmail: "jane@vendor.example",
  organizationName: "Walkthrough Org",
  vendorName: "Stripe",
  message: "Hello Jane,\n\nPlease complete this.\n\nThanks",
  rawToken: TOKEN,
  expiresAt: new Date("2026-10-04T00:00:00Z"),
  dueDate: "2026-09-25",
};

beforeEach(() => mockSendEmail.mockReset());

describe("content", () => {
  it("the default message is professional, names both parties, greets by first name and carries the due date", () => {
    const m = defaultInviteMessage({ contactName: "Jane Security", organizationName: "Walkthrough Org", vendorName: "Stripe", dueDate: "2026-09-25" });
    expect(m.startsWith("Hello Jane,")).toBe(true);
    expect(m).toContain("Walkthrough Org assesses the security and governance posture of its vendors");
    expect(m).toContain("Stripe has been selected");
    expect(m).toContain("September 25, 2026");
    expect(m).toContain("asks only what applies to this relationship");
    expect(m.endsWith("Thank you,\nWalkthrough Org")).toBe(true);
    expect(defaultInviteMessage({ contactName: null, organizationName: "O", vendorName: "V" }).startsWith("Hello,")).toBe(true);
  });

  it("the email carries the message, the secure link, the due date and the expiry — and nothing unescaped", () => {
    const url = buildPortalAcceptUrl(TOKEN, { APP_BASE_URL: "https://securelogic-app-staging.onrender.com/" } as NodeJS.ProcessEnv);
    expect(url).toBe(`https://securelogic-app-staging.onrender.com/portal/accept/${TOKEN}`);
    const e = buildVendorInviteEmail({ ...BASE, message: "Hi <b>Jane</b> & co,\n\nline2", acceptUrl: url });
    expect(e.subject).toBe("Walkthrough Org has asked Stripe to complete a security assessment");
    expect(e.html).toContain("<p>Hi &lt;b&gt;Jane&lt;/b&gt; &amp; co,</p><p>line2</p>");
    expect(e.html).toContain(`href="${url}"`);
    expect(e.html).toContain("Requested response date: September 25, 2026.");
    expect(e.html).toContain("expires on 2026-10-04");
    expect(e.html).toContain("Sent by SecureLogic AI on behalf of Walkthrough Org");
    expect(e.text).toContain(url);
    expect(e.text).toContain("Requested response date: September 25, 2026.");
    expect(e.text).toContain("Hi <b>Jane</b> & co,");
  });

  it("the default base URL is the production app when APP_BASE_URL is unset", () => {
    expect(buildPortalAcceptUrl("t", {} as NodeJS.ProcessEnv)).toBe("https://app.securelogicai.com/portal/accept/t");
  });
});

describe("the flag and the transport result", () => {
  it("is dark unless the flag is exactly \"true\", and reports `disabled` without touching the transport", async () => {
    expect(inviteEmailEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(inviteEmailEnabled({ SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(inviteEmailEnabled({ SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
    const r = await sendVendorInviteEmail({ ...BASE, env: {} as NodeJS.ProcessEnv });
    expect(r).toEqual({ state: "disabled", providerMessageId: null, detail: null });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends through the shared mailer with the vendor.invite purpose, the org and the invite id as correlation; never the token", async () => {
    mockSendEmail.mockResolvedValue({ ok: true, id: "re_123" });
    const env = { SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED: "true", APP_BASE_URL: "https://app.test" } as NodeJS.ProcessEnv;
    const r = await sendVendorInviteEmail({ ...BASE, env });
    expect(r).toEqual({ state: "sent", providerMessageId: "re_123", detail: null });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const call = mockSendEmail.mock.calls[0]![0];
    expect(call.to).toBe("jane@vendor.example");
    expect(call.purpose).toBe(VENDOR_INVITE_EMAIL_PURPOSE);
    expect(call.orgId).toBe(BASE.organizationId);
    expect(call.correlationId).toBe(BASE.inviteId);
    expect(call.html).toContain(`https://app.test/portal/accept/${TOKEN}`);
    // the correlation id is the invite ROW id, never the credential
    expect(call.correlationId).not.toContain(TOKEN);
  });

  it("maps a suppressed recipient and a provider failure honestly, and never throws", async () => {
    const env = { SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED: "true" } as NodeJS.ProcessEnv;
    mockSendEmail.mockResolvedValueOnce({ ok: false, reason: "suppressed" });
    expect((await sendVendorInviteEmail({ ...BASE, env })).state).toBe("suppressed");
    mockSendEmail.mockResolvedValueOnce({ ok: false, reason: "failed", detail: "Resend 422" });
    const failed = await sendVendorInviteEmail({ ...BASE, env });
    expect(failed.state).toBe("failed");
    expect(failed.detail).toBe("failed: Resend 422");
    mockSendEmail.mockRejectedValueOnce(new Error("socket hang up"));
    const threw = await sendVendorInviteEmail({ ...BASE, env });
    expect(threw).toEqual({ state: "failed", providerMessageId: null, detail: "transport error" });
  });
});
