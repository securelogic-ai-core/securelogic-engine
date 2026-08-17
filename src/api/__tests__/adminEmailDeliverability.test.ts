import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import express from "express";
import request from "supertest";

/**
 * GET /admin/email-deliverability/:email — the operator's answer to "why can
 * this customer not receive our mail, and what do I do about it?".
 *
 * The defect it closes: a tenant stranded by a hard bounce was diagnosable only
 * by reading the mail provider's API by hand, because the state lives in three
 * places (provider suppression list, our `email_suppressions` mirror, and the
 * `users` row that makes "stranded" mean anything) and nothing joined them.
 *
 * The two properties that must not regress:
 *   1. it is READ-ONLY — remediation would mutate the Resend account shared
 *      with production, so no write may appear in this route;
 *   2. it stays behind the admin chain — it reports account existence, which
 *      the public API is deliberately careful never to do.
 */

const pgQuery = vi.hoisted(() => vi.fn());
const providerLookup = vi.hoisted(() => vi.fn());

vi.mock("../infra/postgres.js", () => ({
  // M-1 PR-2: the admin surface reads through the elevated channel now.
  pg: { query: vi.fn() },
  pgElevated: { query: pgQuery },
  withTenant: vi.fn()
}));
vi.mock("../infra/providerSuppression.js", () => ({
  getProviderSuppression: providerLookup
}));

const SUPPRESSION_ROW = {
  id: "sup-1",
  email: "blocked@example.com",
  reason: "email.bounced",
  source: "provider_webhook",
  created_at: "2026-08-10T15:47:35.000Z"
};

const UNVERIFIED_USER = {
  id: "user-1",
  email_verified: false,
  created_at: "2026-08-10T15:47:34.000Z",
  organization_id: "org-1"
};

/** Queries run in order: suppression row, then user row. */
function mockDb(suppression: unknown | null, user: unknown | null) {
  pgQuery.mockReset();
  pgQuery
    .mockResolvedValueOnce({ rows: suppression ? [suppression] : [], rowCount: suppression ? 1 : 0 })
    .mockResolvedValueOnce({ rows: user ? [user] : [], rowCount: user ? 1 : 0 });
}

async function app() {
  vi.resetModules();
  const { default: router } = await import("../routes/adminEmailDeliverability.js");
  const a = express();
  a.use(router);
  return a;
}

beforeEach(() => {
  pgQuery.mockReset();
  providerLookup.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /admin/email-deliverability/:email", () => {
  it("reports a STRANDED tenant: unverified account behind a suppressed address", async () => {
    mockDb(SUPPRESSION_ROW, UNVERIFIED_USER);
    providerLookup.mockResolvedValue("suppressed");

    const res = await request(await app()).get("/email-deliverability/blocked@example.com");

    expect(res.status).toBe(200);
    expect(res.body.stranded).toBe(true);
    expect(res.body.mailable).toBe(false);
    expect(res.body.provider_suppression.status).toBe("suppressed");
    expect(res.body.account.exists).toBe(true);
    expect(res.body.account.email_verified).toBe(false);
    expect(res.body.recommendation).toMatch(/cannot self-recover/i);
  });

  it("a suppressed address with NO account is blocked but not stranded", async () => {
    mockDb(SUPPRESSION_ROW, null);
    providerLookup.mockResolvedValue("suppressed");

    const res = await request(await app()).get("/email-deliverability/blocked@example.com");

    expect(res.body.stranded).toBe(false);
    expect(res.body.mailable).toBe(false);
    expect(res.body.account).toEqual({ exists: false });
    expect(res.body.recommendation).toMatch(/No account is stranded/i);
  });

  it("a verified account behind a suppressed address is not stranded", async () => {
    // Already verified — blocked mail is a nuisance, not a lockout.
    mockDb(SUPPRESSION_ROW, { ...UNVERIFIED_USER, email_verified: true });
    providerLookup.mockResolvedValue("suppressed");

    const res = await request(await app()).get("/email-deliverability/blocked@example.com");
    expect(res.body.stranded).toBe(false);
  });

  it("a clean address reports mailable with no suppression", async () => {
    mockDb(null, null);
    providerLookup.mockResolvedValue("clear");

    const res = await request(await app()).get("/email-deliverability/fine@example.com");

    expect(res.body.mailable).toBe(true);
    expect(res.body.stranded).toBe(false);
    expect(res.body.local_suppression).toBeNull();
    expect(res.body.recommendation).toMatch(/should be deliverable/i);
  });

  it("UNKNOWN is never reported as mailable — we did not learn it is fine", async () => {
    mockDb(null, null);
    providerLookup.mockResolvedValue("unknown");

    const res = await request(await app()).get("/email-deliverability/mystery@example.com");

    expect(res.body.mailable).toBeNull();
    expect(res.body.mailable).not.toBe(true);
    expect(res.body.provider_suppression.status).toBe("unknown");
    expect(res.body.recommendation).toMatch(/unknown/i);
  });

  it("surfaces our local mirror row separately from the provider verdict", async () => {
    // The two can disagree: our mirror only exists if the webhook saw the event.
    mockDb(SUPPRESSION_ROW, null);
    providerLookup.mockResolvedValue("clear");

    const res = await request(await app()).get("/email-deliverability/blocked@example.com");

    expect(res.body.local_suppression.reason).toBe("email.bounced");
    expect(res.body.local_suppression.source).toBe("provider_webhook");
    expect(res.body.provider_suppression.status).toBe("clear");
    expect(res.body.mailable).toBe(true); // the provider is authoritative for delivery
  });

  it("rejects a malformed address without touching the database", async () => {
    providerLookup.mockResolvedValue("clear");
    const res = await request(await app()).get("/email-deliverability/not-an-email");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("valid_email_required");
    expect(pgQuery).not.toHaveBeenCalled();
    expect(providerLookup).not.toHaveBeenCalled();
  });

  it("normalises case before looking anything up", async () => {
    mockDb(null, null);
    providerLookup.mockResolvedValue("clear");

    const res = await request(await app()).get("/email-deliverability/MiXeD@Example.COM");

    expect(res.body.email).toBe("mixed@example.com");
    expect(providerLookup).toHaveBeenCalledWith("mixed@example.com");
  });

  it("fails closed with 500 rather than a misleading verdict when the DB errors", async () => {
    pgQuery.mockReset();
    pgQuery.mockRejectedValue(new Error("db down"));
    providerLookup.mockResolvedValue("clear");

    const res = await request(await app()).get("/email-deliverability/x@example.com");

    expect(res.status).toBe(500);
    expect(res.body.mailable).toBeUndefined();
  });
});

describe("source guards: read-only, and admin-gated", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/api/routes/adminEmailDeliverability.ts"),
    "utf8"
  );
  const index = readFileSync(resolve(process.cwd(), "src/api/routes/index.ts"), "utf8");

  it("performs NO writes — remediation mutates the shared production mail account", () => {
    expect(src).not.toMatch(/\bINSERT\b/i);
    expect(src).not.toMatch(/\bUPDATE\b/i);
    expect(src).not.toMatch(/\bDELETE\b/i);
    expect(src).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });

  it("exposes only a GET", () => {
    const verbs = src.match(/router\.[a-z]+\(/g) ?? [];
    expect(verbs).toEqual(["router.get("]);
  });

  it("is mounted under /admin, which carries requireAdminKey", () => {
    expect(index).toContain('router.use("/admin", adminEmailDeliverabilityRouter)');
    // The chain that makes reporting account existence acceptable at all.
    expect(index).toContain("requireAdminKey");
    const chain = index.slice(index.indexOf("const adminChain"), index.indexOf('router.use("/admin", ...adminChain)'));
    expect(chain).toContain("adminLockout");
    expect(chain).toContain("requireAdminKey");
    expect(chain).toContain("adminAudit");
  });

  it("mounts AFTER the admin chain is applied, never before", () => {
    expect(index.indexOf('router.use("/admin", ...adminChain)'))
      .toBeLessThan(index.indexOf('router.use("/admin", adminEmailDeliverabilityRouter)'));
  });
});
