/**
 * riskLifecycleNotifier.test.ts — Risk lifecycle (Epic R4) notifications.
 *
 * Asserts the three triggers fire through the shared transactional sender (mock
 * transport), skip cleanly when the flag is off, never throw, and — crucially —
 * resolve recipients through pgElevated ONLY (the owner pool), never the tenant
 * `pg` client. That is what keeps notifications OUT of the transition transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const RISK = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ ok: true, id: "email-1" })),
  elevatedRows: [] as Record<string, unknown>[],
  elevatedQuery: vi.fn(),
  // A tenant-client query spy that MUST NEVER be called by the notifier.
  tenantQuery: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));

vi.mock("../infra/email.js", () => ({ sendEmail: h.sendEmail }));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: h.tenantQuery, connect: vi.fn() },
  pgElevated: { query: h.elevatedQuery },
}));

import {
  sendOwnerAssignedNotification,
  sendApprovalRequestedNotification,
  sendApprovalDecidedNotification,
  buildOwnerAssignedEmail,
  buildApprovalRequestedEmail,
  buildApprovalDecidedEmail,
} from "../lib/riskLifecycleNotifier.js";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env["SECURELOGIC_RISK_LIFECYCLE_NOTIFICATIONS_ENABLED"] = "true";
  h.sendEmail.mockClear();
  h.sendEmail.mockResolvedValue({ ok: true, id: "email-1" });
  h.tenantQuery.mockClear();
  h.elevatedRows = [];
  h.elevatedQuery.mockReset();
  h.elevatedQuery.mockImplementation(async () => ({ rows: h.elevatedRows, rowCount: h.elevatedRows.length }));
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("flag gating", () => {
  it("skips every trigger and does not query or send when the flag is off", async () => {
    delete process.env["SECURELOGIC_RISK_LIFECYCLE_NOTIFICATIONS_ENABLED"];
    const a = await sendOwnerAssignedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "R", ownerUserId: "u1" });
    const b = await sendApprovalRequestedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "R", requesterName: null });
    const c = await sendApprovalDecidedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "R", proposerUserId: "u1", decision: "approved", comment: null });
    expect(a.ok).toBe(false);
    expect(b.sent).toBe(0);
    expect(c.ok).toBe(false);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.elevatedQuery).not.toHaveBeenCalled();
  });
});

describe("decoupling — never touches the tenant/transaction client", () => {
  it("resolves recipients via pgElevated only, never pg", async () => {
    h.elevatedRows = [{ email: "owner@x.com", name: "Owner" }];
    await sendOwnerAssignedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "R", ownerUserId: "u1" });
    expect(h.elevatedQuery).toHaveBeenCalled();
    expect(h.tenantQuery).not.toHaveBeenCalled();
  });
});

describe("owner assigned", () => {
  it("emails the resolved owner via the shared sender, org-scoped lookup", async () => {
    h.elevatedRows = [{ email: "owner@x.com", name: "Owner" }];
    const r = await sendOwnerAssignedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "Vendor risk", ownerUserId: "u1" });
    expect(r.ok).toBe(true);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const [args] = h.sendEmail.mock.calls[0] as [{ to: string; subject: string }];
    expect(args.to).toBe("owner@x.com");
    expect(args.subject).toContain("Vendor risk");
    // Org id passed to the recipient lookup.
    const [, params] = h.elevatedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toContain(ORG);
  });

  it("does not send when the owner is not resolvable", async () => {
    h.elevatedRows = [];
    const r = await sendOwnerAssignedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "R", ownerUserId: "u1" });
    expect(r.ok).toBe(false);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

describe("approval requested", () => {
  it("emails every eligible approver (admins) resolved for the org", async () => {
    h.elevatedRows = [
      { email: "a1@x.com", name: "A1" },
      { email: "a2@x.com", name: null },
    ];
    const r = await sendApprovalRequestedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "R", requesterName: "Reviewer" });
    expect(r.sent).toBe(2);
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    const [, params] = h.elevatedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([ORG]);
    // Query targets the admin role.
    const [sql] = h.elevatedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/role = 'admin'/);
  });

  it("skips when there are no eligible approvers", async () => {
    h.elevatedRows = [];
    const r = await sendApprovalRequestedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "R", requesterName: null });
    expect(r.sent).toBe(0);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

describe("approval decided", () => {
  it("emails the proposer with the decision outcome", async () => {
    h.elevatedRows = [{ email: "prop@x.com", name: "Prop" }];
    const r = await sendApprovalDecidedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "R", proposerUserId: "u1", decision: "rejected", comment: "needs work" });
    expect(r.ok).toBe(true);
    const [args] = h.sendEmail.mock.calls[0] as [{ to: string; subject: string; html: string }];
    expect(args.to).toBe("prop@x.com");
    expect(args.subject).toContain("rejected");
    expect(args.html).toContain("needs work");
  });
});

describe("never throws", () => {
  it("returns a failure result (not a throw) when the transport throws", async () => {
    h.elevatedRows = [{ email: "owner@x.com", name: "Owner" }];
    h.sendEmail.mockRejectedValueOnce(new Error("resend down"));
    const r = await sendOwnerAssignedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "R", ownerUserId: "u1" });
    expect(r.ok).toBe(false);
  });

  it("returns a failure result when recipient lookup throws", async () => {
    h.elevatedQuery.mockRejectedValueOnce(new Error("db down"));
    const r = await sendApprovalDecidedNotification({ organizationId: ORG, riskId: RISK, riskTitle: "R", proposerUserId: "u1", decision: "approved", comment: null });
    expect(r.ok).toBe(false);
  });
});

describe("pure body builders", () => {
  it("escapes HTML in the risk title", () => {
    const { html, subject } = buildOwnerAssignedEmail(`A<script>b`, "https://app/x", "Jo");
    expect(html).toContain("A&lt;script&gt;b");
    expect(subject).toContain("A<script>b"); // subject is plain text
  });
  it("omits the reviewer note when there is no comment", () => {
    const { html } = buildApprovalDecidedEmail("R", "https://app/x", "P", "approved", null);
    expect(html).not.toContain("Reviewer note");
  });
  it("includes the requester when provided", () => {
    const { html } = buildApprovalRequestedEmail("R", "https://app/x", "Dana");
    expect(html).toContain("by Dana");
  });
});
