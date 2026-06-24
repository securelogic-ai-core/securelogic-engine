import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted mock handles so the vi.mock factories can reference them.
const h = vi.hoisted(() => ({
  send: vi.fn(),
  isSuppressed: vi.fn(),
  isDuplicate: vi.fn(),
  recordSend: vi.fn(),
  selectRecipients: vi.fn(),
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  // passthrough: run the recipient-select callback directly
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../lib/alerting/alertPrimitives.js", () => ({
  isSuppressed: h.isSuppressed,
  isDuplicate: h.isDuplicate,
  recordSend: h.recordSend,
  getResend: () => ({ emails: { send: h.send } }),
  getFromAddress: () => "SecureLogic AI <noreply@test>",
  getAppBaseUrl: () => "http://test",
  htmlEscape: (s: string) => s,
}));

vi.mock("../lib/alerting/alertRecipients.js", () => ({
  selectAlertRecipients: h.selectRecipients,
}));

import { createAlertBatcher } from "../lib/alerting/alertService.js";

const RECIPIENT = { user_id: "u1", email: "user@org.test", organization_name: "Org One" };

beforeEach(() => {
  vi.clearAllMocks();
  h.isSuppressed.mockResolvedValue(false);
  h.isDuplicate.mockResolvedValue(false);
  h.recordSend.mockResolvedValue(undefined);
  h.send.mockResolvedValue({ id: "email_1" });
  h.selectRecipients.mockResolvedValue([RECIPIENT]);
});

describe("createAlertBatcher — coalescing", () => {
  it("sends ONE email per org per cycle, batching N criticals", async () => {
    const b = createAlertBatcher("critical_finding", "test");
    b.add("org-1", { findingId: "f1", title: "A", severity: "Critical", domain: null });
    b.add("org-1", { findingId: "f2", title: "B", severity: "Critical", domain: null });
    b.add("org-1", { findingId: "f3", title: "C", severity: "Critical", domain: null });

    const r = await b.flush();

    expect(h.send).toHaveBeenCalledTimes(1); // one email, not three
    expect(r.emailsSent).toBe(1);
    expect(r.orgsProcessed).toBe(1);
    // ledger recorded once per finding in the batch
    expect(h.recordSend).toHaveBeenCalledTimes(3);
    const sent = h.send.mock.calls[0]![0] as { html: string };
    expect(sent.html).toContain("A");
    expect(sent.html).toContain("B");
    expect(sent.html).toContain("C");
  });

  it("sends one email per org across multiple orgs", async () => {
    h.selectRecipients.mockResolvedValue([RECIPIENT]);
    const b = createAlertBatcher();
    b.add("org-1", { findingId: "f1", title: "A", severity: "Critical", domain: null });
    b.add("org-2", { findingId: "f2", title: "B", severity: "High", domain: null });

    const r = await b.flush();
    expect(r.orgsProcessed).toBe(2);
    expect(h.send).toHaveBeenCalledTimes(2);
  });
});

describe("createAlertBatcher — skips", () => {
  it("suppressed recipient → no send, counted", async () => {
    h.isSuppressed.mockResolvedValue(true);
    const b = createAlertBatcher();
    b.add("org-1", { findingId: "f1", title: "A", severity: "Critical", domain: null });

    const r = await b.flush();
    expect(h.send).not.toHaveBeenCalled();
    expect(r.emailsSent).toBe(0);
    expect(r.recipientsSuppressed).toBe(1);
  });

  it("ledger-duplicate items dropped; all-dupe → no send", async () => {
    h.isDuplicate.mockResolvedValue(true);
    const b = createAlertBatcher();
    b.add("org-1", { findingId: "f1", title: "A", severity: "Critical", domain: null });

    const r = await b.flush();
    expect(h.send).not.toHaveBeenCalled();
    expect(r.emailsSent).toBe(0);
    expect(h.recordSend).not.toHaveBeenCalled();
  });

  it("org with zero eligible recipients → skipped, no send", async () => {
    h.selectRecipients.mockResolvedValue([]);
    const b = createAlertBatcher();
    b.add("org-1", { findingId: "f1", title: "A", severity: "Critical", domain: null });

    const r = await b.flush();
    expect(h.send).not.toHaveBeenCalled();
    expect(r.orgsSkippedNoRecipients).toBe(1);
    expect(r.orgsProcessed).toBe(0);
  });

  it("zero items added → no send, empty result", async () => {
    const b = createAlertBatcher();
    const r = await b.flush();
    expect(h.send).not.toHaveBeenCalled();
    expect(r.emailsSent).toBe(0);
    expect(r.orgsProcessed).toBe(0);
  });
});

describe("createAlertBatcher — double-flush guard", () => {
  it("second flush is a no-op (no duplicate sends)", async () => {
    const b = createAlertBatcher();
    b.add("org-1", { findingId: "f1", title: "A", severity: "Critical", domain: null });

    await b.flush();
    expect(h.send).toHaveBeenCalledTimes(1);

    const second = await b.flush();
    expect(h.send).toHaveBeenCalledTimes(1); // unchanged
    expect(second.emailsSent).toBe(0);
  });
});

describe("createAlertBatcher — per-send failure is non-fatal", () => {
  it("a send error does not throw out of flush", async () => {
    h.send.mockRejectedValue(new Error("resend 500"));
    const b = createAlertBatcher();
    b.add("org-1", { findingId: "f1", title: "A", severity: "Critical", domain: null });

    const r = await b.flush();
    expect(r.emailsSent).toBe(0); // failed, but flush returned cleanly
  });
});
