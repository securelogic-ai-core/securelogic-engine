import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import express from "express";
import request from "supertest";

/**
 * POST /admin/email-deliverability/:email/provider-suppression/clear —
 * the remediation half of the deliverability tooling.
 *
 * What makes this dangerous, and therefore what these tests are for: provider
 * suppressions are ACCOUNT-LEVEL, and production, staging and demo share one
 * Resend account. A clear issued from the wrong environment lifts a block that
 * production depends on, for a real customer, and there is no undo. The
 * properties below are the ones that keep that from happening; none of them is
 * decorative.
 */

const lookupRecord = vi.hoisted(() => vi.fn());
const deleteSuppression = vi.hoisted(() => vi.fn());
const auditWrite = vi.hoisted(() => vi.fn());

vi.mock("../infra/providerSuppression.js", () => ({
  lookupProviderSuppressionRecord: lookupRecord,
  deleteProviderSuppression: deleteSuppression
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEventAwaited: auditWrite,
  writeAuditEvent: vi.fn()
}));

const EMAIL = "blocked@example.com";
const SUPPRESSION_ID = "019fec5b-0000-7000-8000-000000000001";
const PATH = `/email-deliverability/${EMAIL}/provider-suppression`;
const CLEAR_PATH = `${PATH}/clear`;

const SUPPRESSED = {
  outcome: "suppressed" as const,
  record: { id: SUPPRESSION_ID, origin: "bounce", createdAt: "2026-08-10T15:47:35.000Z" }
};

const ORIGINAL_ENV = { ...process.env };

/** Put the process in the one context permitted to mutate the shared account. */
function asProduction() {
  process.env.APP_ENV = "production";
  process.env.SECURELOGIC_EMAIL_SUPPRESSION_RECOVERY_ENABLED = "true";
}

async function app() {
  vi.resetModules();
  const { default: router } = await import("../routes/adminProviderSuppressionRecovery.js");
  const a = express();
  a.use(express.json());
  a.use(router);
  return a;
}

const confirm = (overrides: Record<string, unknown> = {}) => ({
  confirm_email: EMAIL,
  provider_suppression_id: SUPPRESSION_ID,
  ...overrides
});

beforeEach(() => {
  lookupRecord.mockReset();
  deleteSuppression.mockReset();
  auditWrite.mockReset().mockResolvedValue(true);
  delete process.env.APP_ENV;
  delete process.env.SECURELOGIC_EMAIL_SUPPRESSION_RECOVERY_ENABLED;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

// ── the happy path ─────────────────────────────────────────────────────────
describe("authorized clear", () => {
  it("clears the suppression and reports it truthfully", async () => {
    asProduction();
    lookupRecord.mockResolvedValue(SUPPRESSED);
    deleteSuppression.mockResolvedValue({ outcome: "deleted" });

    const res = await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(res.status).toBe(200);
    expect(res.body.result).toBe("cleared");
    expect(res.body.provider_suppression_id).toBe(SUPPRESSION_ID);
    expect(deleteSuppression).toHaveBeenCalledWith(SUPPRESSION_ID);
  });

  it("re-reads from the provider BEFORE deleting — the supplied id is never trusted", async () => {
    asProduction();
    const order: string[] = [];
    lookupRecord.mockImplementation(async () => {
      order.push("read");
      return SUPPRESSED;
    });
    deleteSuppression.mockImplementation(async () => {
      order.push("delete");
      return { outcome: "deleted" };
    });

    await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(order).toEqual(["read", "delete"]);
  });

  it("warns the operator when the clear succeeded but the audit row did not", async () => {
    asProduction();
    lookupRecord.mockResolvedValue(SUPPRESSED);
    deleteSuppression.mockResolvedValue({ outcome: "deleted" });
    auditWrite.mockResolvedValue(false);

    const res = await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(res.body.result).toBe("cleared");
    expect(res.body.audit_recorded).toBe(false);
    expect(res.body.warning).toMatch(/audit row failed/i);
  });
});

// ── the environment boundary: the whole point ──────────────────────────────
describe("environment boundary", () => {
  for (const env of ["staging", "demo"]) {
    it(`REFUSES to mutate shared provider state from ${env}`, async () => {
      process.env.APP_ENV = env;
      process.env.SECURELOGIC_EMAIL_SUPPRESSION_RECOVERY_ENABLED = "true";

      const res = await request(await app()).post(CLEAR_PATH).send(confirm());

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("provider_mutation_not_permitted_in_environment");
      expect(deleteSuppression).not.toHaveBeenCalled();
      // Not even a read: the boundary short-circuits before touching the provider.
      expect(lookupRecord).not.toHaveBeenCalled();
    });
  }

  it("REFUSES when APP_ENV is unset — absence of proof is not proof of production", async () => {
    process.env.SECURELOGIC_EMAIL_SUPPRESSION_RECOVERY_ENABLED = "true";

    const res = await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("provider_mutation_not_permitted_in_environment");
    expect(deleteSuppression).not.toHaveBeenCalled();
  });

  it("REFUSES in production while the flag is off — default is dormant", async () => {
    process.env.APP_ENV = "production";

    const res = await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("provider_suppression_recovery_disabled");
    expect(deleteSuppression).not.toHaveBeenCalled();
  });

  it("REFUSES on a flag value that is not exactly 'true'", async () => {
    for (const value of ["TRUE", "1", "yes", ""]) {
      process.env.APP_ENV = "production";
      process.env.SECURELOGIC_EMAIL_SUPPRESSION_RECOVERY_ENABLED = value;

      const res = await request(await app()).post(CLEAR_PATH).send(confirm());

      expect(res.status).toBe(403);
      expect(deleteSuppression).not.toHaveBeenCalled();
    }
  });

  it("records the refused attempt — a near-miss must be findable later", async () => {
    process.env.APP_ENV = "staging";
    process.env.SECURELOGIC_EMAIL_SUPPRESSION_RECOVERY_ENABLED = "true";

    await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "email.provider_suppression.refused",
        resourceType: "provider_email_suppression",
        payload: expect.objectContaining({
          reason: "provider_mutation_not_permitted_in_environment"
        })
      })
    );
  });
});

// ── confirmation ───────────────────────────────────────────────────────────
describe("explicit confirmation", () => {
  it("rejects a body with no confirmation at all", async () => {
    asProduction();

    const res = await request(await app()).post(CLEAR_PATH).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("confirmation_required");
    expect(deleteSuppression).not.toHaveBeenCalled();
    expect(lookupRecord).not.toHaveBeenCalled();
  });

  it("rejects a confirmation for a DIFFERENT address than the path", async () => {
    asProduction();

    const res = await request(await app())
      .post(CLEAR_PATH)
      .send(confirm({ confirm_email: "someone.else@example.com" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("confirmation_required");
    expect(deleteSuppression).not.toHaveBeenCalled();
  });

  it("rejects a confirmation with no suppression id", async () => {
    asProduction();

    const res = await request(await app())
      .post(CLEAR_PATH)
      .send({ confirm_email: EMAIL });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("provider_suppression_id_required");
    expect(deleteSuppression).not.toHaveBeenCalled();
  });

  it("rejects an oversized id rather than echoing it into the audit payload", async () => {
    asProduction();

    const res = await request(await app())
      .post(CLEAR_PATH)
      .send(confirm({ provider_suppression_id: "x".repeat(5000) }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("provider_suppression_id_required");
    expect(auditWrite).not.toHaveBeenCalled();
    expect(lookupRecord).not.toHaveBeenCalled();
  });
});

// ── provider state changed under us ────────────────────────────────────────
describe("stale id / race", () => {
  it("REFUSES when the live suppression is not the one the operator confirmed", async () => {
    asProduction();
    lookupRecord.mockResolvedValue({
      outcome: "suppressed",
      record: { id: "a-newer-id", origin: "bounce", createdAt: "2026-08-11T09:00:00.000Z" }
    });

    const res = await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("provider_suppression_changed");
    expect(res.body.confirmed_id).toBe(SUPPRESSION_ID);
    expect(res.body.current_id).toBe("a-newer-id");
    // The newer block — probably a fresh bounce — must survive.
    expect(deleteSuppression).not.toHaveBeenCalled();
  });

  it("reports already_absent when the provider has nothing to clear", async () => {
    asProduction();
    lookupRecord.mockResolvedValue({ outcome: "clear" });

    const res = await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(res.status).toBe(200);
    expect(res.body.result).toBe("already_absent");
    expect(deleteSuppression).not.toHaveBeenCalled();
  });

  it("reports already_absent when the record vanishes between read and delete", async () => {
    asProduction();
    lookupRecord.mockResolvedValue(SUPPRESSED);
    deleteSuppression.mockResolvedValue({ outcome: "already_absent" });

    const res = await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(res.status).toBe(200);
    expect(res.body.result).toBe("already_absent");
  });
});

// ── provider failure: fail CLOSED ──────────────────────────────────────────
describe("provider failure", () => {
  it("does NOT delete when the pre-read is unavailable — unknown is not 'go ahead'", async () => {
    asProduction();
    lookupRecord.mockResolvedValue({
      outcome: "unavailable",
      detail: "Provider returned HTTP 500."
    });

    const res = await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(res.status).toBe(503);
    expect(res.body.result).toBe("provider_unavailable");
    expect(deleteSuppression).not.toHaveBeenCalled();
    expect(res.body.detail).toMatch(/do not assume the address is clear/i);
  });

  it("reports a failed delete truthfully rather than as success", async () => {
    asProduction();
    lookupRecord.mockResolvedValue(SUPPRESSED);
    deleteSuppression.mockResolvedValue({
      outcome: "failed",
      detail: "Provider returned HTTP 429."
    });

    const res = await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(res.status).toBe(502);
    expect(res.body.result).toBe("failed");
    expect(res.body.detail).toContain("429");
  });

  it("survives an unexpected throw without claiming anything was cleared", async () => {
    asProduction();
    lookupRecord.mockRejectedValue(new Error("boom"));

    const res = await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(res.status).toBe(500);
    expect(res.body.result).toBe("failed");
    expect(deleteSuppression).not.toHaveBeenCalled();
  });
});

// ── audit ──────────────────────────────────────────────────────────────────
describe("audit", () => {
  it("writes a platform-level audit event naming the exact email and record", async () => {
    asProduction();
    lookupRecord.mockResolvedValue(SUPPRESSED);
    deleteSuppression.mockResolvedValue({ outcome: "deleted" });

    await request(await app()).post(CLEAR_PATH).send(confirm());

    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "email.provider_suppression.cleared",
        resourceType: "provider_email_suppression",
        resourceId: SUPPRESSION_ID,
        // Provider suppressions are account-level and have no tenant.
        organizationId: null,
        payload: expect.objectContaining({ email: EMAIL })
      })
    );
  });

  it("awaits the audit write rather than firing and forgetting it", async () => {
    asProduction();
    lookupRecord.mockResolvedValue(SUPPRESSED);
    deleteSuppression.mockResolvedValue({ outcome: "deleted" });

    let settled = false;
    auditWrite.mockImplementation(
      () => new Promise((r) => setImmediate(() => { settled = true; r(true); }))
    );

    await request(await app()).post(CLEAR_PATH).send(confirm());

    // If the response had been sent without awaiting, this would still be false.
    expect(settled).toBe(true);
  });
});

// ── the read-only preview ──────────────────────────────────────────────────
describe("GET preview", () => {
  it("returns the identifier the clear call requires", async () => {
    asProduction();
    lookupRecord.mockResolvedValue(SUPPRESSED);

    const res = await request(await app()).get(PATH);

    expect(res.status).toBe(200);
    expect(res.body.suppressed).toBe(true);
    expect(res.body.provider_suppression.id).toBe(SUPPRESSION_ID);
    expect(res.body.clear_permitted_here).toBe(true);
  });

  it("is readable from staging but says the clear is not permitted there", async () => {
    process.env.APP_ENV = "staging";
    lookupRecord.mockResolvedValue(SUPPRESSED);

    const res = await request(await app()).get(PATH);

    expect(res.status).toBe(200);
    expect(res.body.clear_permitted_here).toBe(false);
    expect(res.body.clear_blocked_reason).toBe(
      "provider_mutation_not_permitted_in_environment"
    );
  });

  it("never mutates — no delete on any preview path", async () => {
    asProduction();
    for (const outcome of [SUPPRESSED, { outcome: "clear" }, { outcome: "unavailable", detail: "x" }]) {
      lookupRecord.mockResolvedValue(outcome);
      await request(await app()).get(PATH);
    }
    expect(deleteSuppression).not.toHaveBeenCalled();
  });

  it("rejects a malformed address", async () => {
    asProduction();

    const res = await request(await app()).get("/email-deliverability/not-an-email/provider-suppression");

    expect(res.status).toBe(400);
    expect(lookupRecord).not.toHaveBeenCalled();
  });
});

// ── no side effects beyond the provider ────────────────────────────────────
describe("blast radius", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/api/routes/adminProviderSuppressionRecovery.ts"),
    "utf8"
  );
  /** Comments explain what the route deliberately does NOT do; don't match those. */
  const code = src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  it("touches no database table directly", () => {
    expect(code).not.toMatch(/\bpg\.query\b/);
    expect(code).not.toMatch(/\bpgElevated\.query\b/);
    expect(code).not.toMatch(/\bUPDATE\b|\bDELETE FROM\b|\bINSERT INTO\b/);
  });

  it("rotates no verification token and mutates no user", () => {
    expect(code).not.toMatch(/verification_token|email_verified|FROM users/);
  });

  it("sends no mail — recovery and resend are separate operator decisions", () => {
    expect(code).not.toMatch(/sendEmail|resend\.emails|sendVerification/);
  });

  it("does not silently clear our own email_suppressions mirror (O-8 says keep it)", () => {
    // The route names the table in an operator-facing string, to say it is
    // being left alone — so absence of the word proves nothing. What proves it
    // is that the route cannot reach any table at all: it never imports the
    // database, so no SQL against email_suppressions is reachable from here.
    expect(code).not.toMatch(/from ["'].*infra\/postgres\.js["']/);
    expect(code).not.toMatch(/(FROM|INTO|UPDATE)\s+email_suppressions/i);
  });
});

// ── wiring ─────────────────────────────────────────────────────────────────
describe("wiring: the destructive route sits behind the admin chain", () => {
  const index = readFileSync(
    resolve(process.cwd(), "src/api/routes/index.ts"),
    "utf8"
  );

  it("is mounted under /admin, AFTER the admin middleware chain is applied", () => {
    const chainAt = index.indexOf('router.use("/admin", ...adminChain)');
    const mountAt = index.indexOf(
      'router.use("/admin", adminProviderSuppressionRecoveryRouter)'
    );
    expect(chainAt).toBeGreaterThan(-1);
    expect(mountAt).toBeGreaterThan(-1);
    // A non-admin caller is rejected by that chain; mounting before it would
    // expose an unauthenticated provider mutation.
    expect(mountAt).toBeGreaterThan(chainAt);
  });

  it("the admin chain still authenticates before auditing", () => {
    const chain = index.slice(index.indexOf("const adminChain"));
    const body = chain.slice(0, chain.indexOf("]"));
    expect(body.indexOf("requireAdminKey")).toBeLessThan(body.indexOf("adminAudit"));
  });
});

// ── the diagnosis route must stay read-only ────────────────────────────────
describe("the read-only diagnosis route is unchanged by this work", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/api/routes/adminEmailDeliverability.ts"),
    "utf8"
  );
  const code = src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  it("performs no write and no provider mutation", () => {
    expect(code).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
    expect(code).not.toMatch(/deleteProviderSuppression/);
    expect(code).toMatch(/router\.get\(/);
    expect(code).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });

  it("still returns its original contract fields", () => {
    for (const field of [
      "mailable",
      "stranded",
      "provider_suppression",
      "local_suppression",
      "account",
      "recommendation"
    ]) {
      expect(code).toContain(field);
    }
  });

  it("still uses the fail-open status lookup, not the fail-closed record read", () => {
    // Swapping these would change signup-adjacent diagnosis semantics.
    expect(code).toContain("getProviderSuppression");
    expect(code).not.toContain("lookupProviderSuppressionRecord");
  });
});
