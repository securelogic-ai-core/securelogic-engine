/**
 * customerAuthSignupMailStatus.test.ts — POST /api/auth/signup tells the truth
 * about the verification email.
 *
 * Signup used to fire the email and forget it:
 *
 *     sendEmail(...).catch((err) => logger.warn(...));
 *     res.status(201).json({ ok: true, message: "verification_email_sent" });
 *
 * getResend() THROWS when RESEND_API_KEY is unset, so on an environment missing
 * that key every new tenant was created, told its verification email was on the
 * way, and locked out permanently: login answers 403 email_not_verified and the
 * token exists only in the database. There was no error the customer could see
 * and no self-serve way back. A confident false statement about the system's
 * own action — the same class the EDX programme exists to eliminate, on the
 * very first screen a customer ever touches.
 *
 * Two things are held here, and they pull in opposite directions:
 *   * the account must SURVIVE a mail outage — it is a fully provisioned
 *     tenant, and discarding it would destroy real customer state to punish an
 *     infrastructure problem;
 *   * the RESPONSE must never claim delivery that did not happen.
 *
 * Being specific is safe HERE and nowhere else in this router: the caller just
 * created the account and owns it, so there is no enumeration surface. That is
 * why /auth/resend-verification still answers identically for every address and
 * is deliberately NOT changed — making it truthful would turn it into an
 * account-existence oracle.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// EMAIL-OBS-1: this suite drives a MOCKED provider. The shared transport
// refuses to send from a test runner unless this opt-out is set explicitly
// (see emailTransport.isTestRunnerSendBlocked) — per file, greppable.
process.env.SECURELOGIC_EMAIL_ALLOW_TEST_SEND = "true";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => {
  const clientCalls: string[] = [];
  const sendCalls: unknown[] = [];
  /** Set by each test: what the provider does when asked to send. */
  const send = vi.fn(async (payload: unknown) => {
    sendCalls.push(payload);
    return { data: { id: "email-1" }, error: null };
  });
  const fakeClient = {
    query: vi.fn(async (sql: string) => {
      clientCalls.push(sql);
      if (/INSERT INTO organizations/.test(sql)) return { rows: [{ id: ORG }] };
      if (/INSERT INTO users/.test(sql)) return { rows: [{ id: USER }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  /**
   * The non-transactional pool. Signup uses it once to check for an existing
   * email (no rows = free to proceed); the resend tests below use it to stand
   * up a real unverified user, so `pgRows` is what decides which.
   */
  const pgRows: { current: unknown[] } = { current: [] };
  const pgCalls: string[] = [];
  const pgQuery = vi.fn(async (sql: string) => {
    pgCalls.push(sql);
    if (/SELECT id, name, email_verified FROM users/.test(sql)) {
      return { rows: pgRows.current };
    }
    return { rows: [] };
  });
  return { clientCalls, sendCalls, send, fakeClient, pgRows, pgCalls, pgQuery };
});

vi.mock("express-rate-limit", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: h.send };
  },
}));
vi.mock("../infra/postgres.js", () => ({
  // M-1 PR-2: identity-plane queries moved to the elevated channel.
  pg: { query: vi.fn(async () => ({ rows: [] })) },
  pgElevated: { connect: vi.fn(async () => h.fakeClient), query: h.pgQuery },
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../lib/sentry.js", () => ({ captureException: vi.fn() }));
vi.mock("../lib/authAnomaly.js", () => ({ recordAccountLockout: vi.fn() }));
vi.mock("../lib/passwordHistory.js", () => ({
  checkPasswordReuse: vi.fn(async () => false),
  recordPasswordHash: vi.fn(async () => {}),
}));

import express from "express";
import request from "supertest";
import customerAuthRouter from "../routes/customerAuth.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", customerAuthRouter);
  return app;
}

const VALID_BODY = {
  organizationName: "Acme Inc",
  name: "Alice Admin",
  email: "alice@example.com",
  password: "Password1234",
  acceptedTerms: true,
};

const signup = () => request(makeApp()).post("/api/auth/signup").send(VALID_BODY);

/** Every SQL statement the signup transaction ran. */
const ranSql = (re: RegExp) => h.clientCalls.some((s) => re.test(s));

beforeEach(() => {
  h.clientCalls.length = 0;
  h.sendCalls.length = 0;
  h.pgCalls.length = 0;
  h.pgRows.current = [];
  h.fakeClient.query.mockClear();
  h.pgQuery.mockClear();
  h.send.mockClear();
  h.send.mockImplementation(async (payload: unknown) => {
    h.sendCalls.push(payload);
    return { data: { id: "email-1" }, error: null };
  });
  process.env.RESEND_API_KEY = "re_test_key";
});

// ─────────────────────────────────────────────────────────────

describe("POST /api/auth/signup — the email actually sent", () => {
  it("reports sent, and only then uses the delivery wording", async () => {
    const res = await signup();

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      message: "verification_email_sent",
      verification_email: "sent",
    });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("awaits the send — the provider is called BEFORE the response resolves", async () => {
    // Fire-and-forget was the root cause: the response could not reflect an
    // outcome it never waited for. A slow provider must delay the answer.
    let released = false;
    h.send.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 25));
      released = true;
      return { data: { id: "email-1" }, error: null };
    });

    const res = await signup();

    expect(released).toBe(true);
    expect(res.body.verification_email).toBe("sent");
  });

  it("sends to the signup address with a verification link", async () => {
    await signup();

    const payload = h.sendCalls[0] as { to: string[]; subject: string; html: string };
    expect(payload.to).toContain("alice@example.com");
    expect(payload.subject).toMatch(/verify/i);
    expect(payload.html).toMatch(/\/verify-email\?token=/);
  });
});

describe("POST /api/auth/signup — provider unavailable (no RESEND_API_KEY)", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it("does not claim delivery, and says so explicitly", async () => {
    const res = await signup();

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.verification_email).toBe("unavailable");
    expect(res.body.message).toBe("verification_email_not_sent");
  });

  it("never emits the delivery wording ANYWHERE in the body", async () => {
    const res = await signup();

    // The whole serialized response, not just `message`: a truthful field
    // beside a stale "sent" string somewhere else would still be read as
    // delivery by a client or a human.
    expect(JSON.stringify(res.body)).not.toContain("verification_email_sent");
  });

  it("gives the customer an exact recovery path", async () => {
    const res = await signup();

    expect(res.body.detail).toMatch(/could not send/i);
    expect(res.body.detail).toMatch(/cannot sign in/i);
    expect(res.body.recovery).toMatchObject({
      resend_path: "/verify-email",
      resend_endpoint: "/api/auth/resend-verification",
      support_email: "hello@securelogicai.com",
    });
  });

  it("never contacts the provider at all", async () => {
    await signup();
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/signup — provider configured but the send fails", () => {
  beforeEach(() => {
    h.send.mockImplementation(async () => {
      throw new Error("provider rejected the message");
    });
  });

  it("reports failed, distinctly from unavailable", async () => {
    const res = await signup();

    expect(res.status).toBe(201);
    expect(res.body.verification_email).toBe("failed");
    expect(res.body.message).toBe("verification_email_not_sent");
    // The two are kept apart because they need different operator responses:
    // one is a deployment gap, the other is a delivery problem.
    expect(res.body.verification_email).not.toBe("unavailable");
  });

  it("never claims delivery", async () => {
    const res = await signup();
    expect(JSON.stringify(res.body)).not.toContain("verification_email_sent");
  });

  it("still returns the recovery path", async () => {
    const res = await signup();
    expect(res.body.recovery?.resend_endpoint).toBe("/api/auth/resend-verification");
  });

  it("a thrown provider error does not become a 500", async () => {
    // The account exists. Answering 500 would tell the customer their signup
    // failed and invite them to retry into email_already_registered.
    const res = await signup();
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });
});

describe("POST /api/auth/signup — tenant provisioning survives every mail outcome", () => {
  const provisioningIsComplete = () => {
    // The four things that make a tenant usable. Missing api_keys is not
    // cosmetic: requireApiKey's JWT bridge 401s `no_active_api_key` without an
    // active row, so a tenant lacking one cannot call a single endpoint.
    expect(ranSql(/INSERT INTO organizations/)).toBe(true);
    expect(ranSql(/INSERT INTO api_keys/)).toBe(true);
    expect(ranSql(/INSERT INTO users/)).toBe(true);
    expect(ranSql(/INSERT INTO legal_consents/)).toBe(true);
    // And it was committed, not rolled back.
    expect(ranSql(/COMMIT/)).toBe(true);
    expect(ranSql(/ROLLBACK/)).toBe(false);
  };

  it("provisions and commits when the email sends", async () => {
    await signup();
    provisioningIsComplete();
  });

  it("provisions and commits when the provider is unavailable", async () => {
    delete process.env.RESEND_API_KEY;
    await signup();
    provisioningIsComplete();
  });

  it("provisions and commits when the send fails", async () => {
    h.send.mockImplementation(async () => {
      throw new Error("provider rejected the message");
    });
    await signup();
    provisioningIsComplete();
  });

  it("does NOT roll back a valid signup because mail failed", async () => {
    // A mail outage is an infrastructure problem. Discarding a fully
    // provisioned tenant to punish it would destroy real customer state, and
    // the address is still verifiable later via resend.
    delete process.env.RESEND_API_KEY;
    const res = await signup();

    expect(res.body.ok).toBe(true);
    expect(ranSql(/ROLLBACK/)).toBe(false);
  });
});

/**
 * The recovery path signup now advertises. It carried the identical defect —
 * fire-and-forget send, unconditional `{ ok: true }`, a UI that turned that into
 * "Verification email resent" — so a customer locked out by a missing provider
 * was handed a button that did nothing and said it worked.
 *
 * It cannot be fixed the way signup was. Signup's caller owns the account it
 * just created, so a per-address answer tells them only what they already know.
 * Here the caller is anonymous, and any answer that varies with the address —
 * in content OR in timing — is an account-existence oracle. So the send stays
 * fire-and-forget (awaiting it would make a real unverified user measurably
 * slower to answer than a stranger) and the only thing reported is the one fact
 * that is identical for every address on earth: whether a provider exists.
 */
describe("POST /api/auth/resend-verification — honest without becoming an oracle", () => {
  const UNVERIFIED_USER = [{ id: USER, name: "Alice Admin", email_verified: false }];
  const resend = (email: string) =>
    request(makeApp()).post("/api/auth/resend-verification").send({ email });

  it("says unavailable rather than claiming a resend, when no provider is configured", async () => {
    delete process.env.RESEND_API_KEY;
    h.pgRows.current = UNVERIFIED_USER;

    const res = await resend("alice@example.com");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, verification_email: "unavailable" });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("short-circuits before touching the database", async () => {
    // Not an optimisation. Rotating the token would invalidate the one already
    // in the database — the last route by which an operator could still rescue
    // the account — in exchange for a replacement nobody can receive.
    delete process.env.RESEND_API_KEY;
    h.pgRows.current = UNVERIFIED_USER;

    await resend("alice@example.com");

    expect(h.pgQuery).not.toHaveBeenCalled();
  });

  it("answers unavailable identically for an address with no account", async () => {
    // The whole enumeration defence: this must be indistinguishable from the
    // case above. It is safe to state precisely because it is a fact about the
    // deployment, not about the address.
    delete process.env.RESEND_API_KEY;
    h.pgRows.current = [];

    const res = await resend("nobody@example.com");

    expect(res.body).toEqual({ ok: true, verification_email: "unavailable" });
  });

  it("claims only `attempted` when a provider IS configured", async () => {
    h.pgRows.current = UNVERIFIED_USER;

    const res = await resend("alice@example.com");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, verification_email: "attempted" });
    // Never the stronger word: the send is unobserved by construction.
    expect(JSON.stringify(res.body)).not.toContain("sent");
  });

  it("gives byte-identical answers for a real user, a stranger, and a malformed address", async () => {
    h.pgRows.current = UNVERIFIED_USER;
    const real = await resend("alice@example.com");

    h.pgRows.current = [];
    const stranger = await resend("nobody@example.com");
    const malformed = await resend("not-an-email");

    expect(stranger.body).toEqual(real.body);
    expect(malformed.body).toEqual(real.body);
  });

  it("still rotates the token and sends for a real unverified user", async () => {
    // The truthfulness work must not have quietly disabled the recovery it
    // exists to point people at.
    h.pgRows.current = UNVERIFIED_USER;

    await resend("alice@example.com");

    expect(h.pgCalls.some((s) => /UPDATE users/.test(s) && /email_verification_token/.test(s))).toBe(true);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/auth/signup — unrelated behaviour is unchanged", () => {
  it("still requires accepted terms before creating anything", async () => {
    const res = await request(makeApp())
      .post("/api/auth/signup")
      .send({ ...VALID_BODY, acceptedTerms: false });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_terms_acceptance");
    expect(h.clientCalls).toHaveLength(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("still validates the password before creating anything", async () => {
    const res = await request(makeApp())
      .post("/api/auth/signup")
      .send({ ...VALID_BODY, password: "short" });

    expect(res.status).toBe(400);
    expect(h.clientCalls).toHaveLength(0);
  });
});
