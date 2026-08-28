/**
 * jwtTokenType.test.ts — SEC-TOKEN-1 (issue #821): the session verifier must
 * accept ONLY tokens minted as sessions, and every purpose-specific verifier
 * must reject session tokens.
 *
 * Before this package, verifyJwt() checked signature + exp and never read the
 * purpose claim, so an MFA-challenge token — handed to the client BEFORE the
 * second factor — structurally satisfied requireAuth and the requireApiKey
 * bridge. It was masked only because the challenge carries no `se`. The
 * middleware cases below therefore forge a challenge-shaped token that DOES
 * carry an epoch, so the type check — not the epoch check — is what must do
 * the work; the test cannot pass vacuously.
 *
 * Both middlewares run against the REAL jwt.ts. Only Postgres, the logger and
 * the audit log are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "crypto";

process.env.JWT_SECRET = "sec-token-1-test-secret-at-least-32-characters-long";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const ORG_ID  = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";

const queryMock = vi.fn();
const auditMock = vi.fn();

vi.mock("../infra/postgres.js", () => ({
  pg: { query: (...args: unknown[]) => queryMock(...args) },
  pgElevated: { query: (...args: unknown[]) => queryMock(...args) },
  withTenant: vi.fn(),
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: (...args: unknown[]) => auditMock(...args),
}));

import {
  signJwt,
  signMfaChallenge,
  verifyJwt,
  verifyMfaChallenge,
  verifyJwtDetailed,
  SESSION_TOKEN_TYPE,
} from "../lib/jwt.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireAuth } from "../middleware/requireAuth.js";

/* ─── helpers ──────────────────────────────────────────────────────────── */

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** Forge an HS256 token with the real secret and an arbitrary payload/header. */
function forge(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }): string {
  const signing = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET!).update(signing).digest("base64url");
  return `${signing}.${sig}`;
}

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

/** Re-sign a token with its payload mutated by `mutate` (claim tampering with a valid signature). */
function resign(token: string, mutate: (p: Record<string, unknown>) => Record<string, unknown> | void): string {
  const p = decodePayload(token);
  const next = mutate(p) ?? p;
  return forge(next);
}

const now = () => Math.floor(Date.now() / 1000);

function bridgeApp() {
  const app = express();
  app.get("/probe", requireApiKey, (req, res) => res.json({ ok: true, role: req.userRole }));
  return app;
}
function authApp() {
  const app = express();
  app.get("/probe", requireAuth, (req, res) => res.json({ ok: true, role: req.jwtPayload?.role }));
  return app;
}

function primeDb(userRow: Record<string, unknown> | null = { status: "active", role: "viewer", password_changed_at: null, seat_type: "full", session_epoch: 0 }) {
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes("FROM users")) {
      return Promise.resolve({ rows: userRow ? [userRow] : [], rowCount: userRow ? 1 : 0 });
    }
    if (sql.includes("FROM api_keys")) {
      return Promise.resolve({ rows: [{ id: "key-1", organization_id: ORG_ID, status: "active" }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => {
  queryMock.mockReset();
  auditMock.mockReset();
  primeDb();
});

/* ─── the invariant, at the library boundary ───────────────────────────── */

describe("verifyJwt — session verifier accepts ONLY session tokens", () => {
  it("accepts a token minted by signJwt (positive control)", () => {
    const p = verifyJwt(signJwt(USER_ID, ORG_ID, "viewer", 3));
    expect(p).not.toBeNull();
    expect(p).toMatchObject({ sub: USER_ID, org: ORG_ID, role: "viewer", se: 3, type: SESSION_TOKEN_TYPE });
  });

  it("DEFECT PROOF: rejects a real signMfaChallenge token", () => {
    expect(verifyJwt(signMfaChallenge(USER_ID, ORG_ID))).toBeNull();
  });

  it("rejects a challenge-shaped token even when it carries a session epoch (epoch must not be the boundary)", () => {
    const withEpoch = resign(signMfaChallenge(USER_ID, ORG_ID), (p) => ({ ...p, se: 0, role: "admin" }));
    expect(verifyJwt(withEpoch)).toBeNull();
  });

  it("rejects a validly-signed token with NO type claim (legacy session shape)", () => {
    const legacy = forge({ sub: USER_ID, org: ORG_ID, role: "admin", se: 0, iat: now(), exp: now() + 3600 });
    expect(verifyJwt(legacy)).toBeNull();
    expect(verifyJwtDetailed(legacy)).toEqual({ ok: false, reason: "legacy_untyped" });
  });

  it.each([
    ["mfa_challenge"], ["password_reset"], ["invite"], ["email_verify"], ["portal"], ["refresh"],
    ["Session"], ["session "], [" session"], ["SESSION"], [""], [null], [0], [true], [["session"]], [{ type: "session" }],
  ])("rejects a validly-signed token whose type is %j", (type) => {
    const t = forge({ sub: USER_ID, org: ORG_ID, role: "admin", se: 0, type, iat: now(), exp: now() + 3600 });
    expect(verifyJwt(t)).toBeNull();
    const d = verifyJwtDetailed(t);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("wrong_type");
  });

  it("claim tampering: stripping the type from a real session token invalidates it", () => {
    const t = signJwt(USER_ID, ORG_ID, "viewer", 1);
    // unsigned tamper → signature fails
    const [h, , s] = t.split(".");
    const p = decodePayload(t); delete p.type;
    expect(verifyJwt(`${h}.${b64url(JSON.stringify(p))}.${s}`)).toBeNull();
    // re-signed tamper → type check fails
    expect(verifyJwt(resign(t, (q) => { delete q.type; }))).toBeNull();
  });

  it("does not backfill a missing role to admin — a typed session token without a role is rejected", () => {
    const t = forge({ sub: USER_ID, org: ORG_ID, se: 0, type: "session", iat: now(), exp: now() + 3600 });
    expect(verifyJwt(t)).toBeNull();
    const t2 = forge({ sub: USER_ID, org: ORG_ID, role: "", se: 0, type: "session", iat: now(), exp: now() + 3600 });
    expect(verifyJwt(t2)).toBeNull();
  });

  it("ignores the header alg: alg=none / RS256 headers with a forged or missing signature are rejected", () => {
    const body = { sub: USER_ID, org: ORG_ID, role: "admin", se: 0, type: "session", iat: now(), exp: now() + 3600 };
    const noneTok = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify(body))}.`;
    expect(verifyJwt(noneTok)).toBeNull();
    const rsTok = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(body))}.${b64url("x")}`;
    expect(verifyJwt(rsTok)).toBeNull();
    // A wrong header alg with a CORRECT HMAC still verifies — the verifier pins HS256 and never trusts the header.
    expect(verifyJwt(forge(body, { alg: "none", typ: "JWT" }))).not.toBeNull();
  });

  it("still rejects expiry and wrong-secret signatures", () => {
    expect(verifyJwt(forge({ sub: USER_ID, org: ORG_ID, role: "admin", se: 0, type: "session", iat: now() - 10, exp: now() - 1 }))).toBeNull();
    const t = signJwt(USER_ID, ORG_ID);
    const [h, b] = t.split(".");
    const badSig = crypto.createHmac("sha256", "other-secret").update(`${h}.${b}`).digest("base64url");
    expect(verifyJwt(`${h}.${b}.${badSig}`)).toBeNull();
  });
});

describe("verifyMfaChallenge — challenge verifier rejects session tokens", () => {
  it("accepts a real challenge (positive control)", () => {
    expect(verifyMfaChallenge(signMfaChallenge(USER_ID, ORG_ID))).toMatchObject({ sub: USER_ID, org: ORG_ID, type: "mfa_challenge" });
  });
  it("rejects a session token", () => {
    expect(verifyMfaChallenge(signJwt(USER_ID, ORG_ID, "admin", 0))).toBeNull();
  });
  it("rejects a session token relabelled as a challenge only if unsigned; a re-signed relabel is a challenge (same secret) — so the challenge route grants nothing beyond MFA completion", () => {
    const t = signJwt(USER_ID, ORG_ID, "admin", 0);
    const [h, , s] = t.split(".");
    const p = decodePayload(t); p.type = "mfa_challenge";
    expect(verifyMfaChallenge(`${h}.${b64url(JSON.stringify(p))}.${s}`)).toBeNull();
  });
});

/* ─── the invariant, at the middleware boundary ────────────────────────── */

describe("requireAuth (/api/auth/*)", () => {
  it("accepts a fresh session token (positive control)", async () => {
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${signJwt(USER_ID, ORG_ID, "viewer", 0)}`);
    expect(res.status).toBe(200);
  });

  it("DEFECT PROOF: rejects a real MFA-challenge token", async () => {
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${signMfaChallenge(USER_ID, ORG_ID)}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_or_expired_token");
  });

  it("rejects a challenge token that carries an epoch (the type check, not the epoch check, is the boundary)", async () => {
    const withEpoch = resign(signMfaChallenge(USER_ID, ORG_ID), (p) => ({ ...p, se: 0 }));
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${withEpoch}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_or_expired_token");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it.each([["password_reset"], ["invite"], ["portal"], ["email_verify"]])("rejects a validly-signed %s-purpose token", async (type) => {
    const t = forge({ sub: USER_ID, org: ORG_ID, role: "admin", se: 0, type, iat: now(), exp: now() + 600 });
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("legacy untyped session token → 401 session_invalidated (a code the app tier forces re-login on)", async () => {
    const legacy = forge({ sub: USER_ID, org: ORG_ID, role: "admin", se: 0, iat: now(), exp: now() + 3600 });
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${legacy}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_invalidated");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("a legacy untyped token with a BAD signature is plain invalid, not session_invalidated (no oracle on unsigned input)", async () => {
    const legacy = forge({ sub: USER_ID, org: ORG_ID, role: "admin", se: 0, iat: now(), exp: now() + 3600 });
    const [h, b] = legacy.split(".");
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${h}.${b}.${b64url("nope")}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_or_expired_token");
  });

  it("epoch check is still independent: a typed session token WITHOUT se → session_epoch_missing", async () => {
    const t = forge({ sub: USER_ID, org: ORG_ID, role: "admin", type: "session", iat: now(), exp: now() + 3600 });
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_epoch_missing");
  });
});

describe("requireApiKey JWT bridge (all data routes)", () => {
  it("accepts a fresh session token (positive control)", async () => {
    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${signJwt(USER_ID, ORG_ID, "viewer", 0)}`);
    expect(res.status).toBe(200);
  });

  it("DEFECT PROOF: rejects a real MFA-challenge token", async () => {
    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${signMfaChallenge(USER_ID, ORG_ID)}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
  });

  it("rejects a challenge token that carries an epoch, and audits it as a type rejection", async () => {
    const withEpoch = resign(signMfaChallenge(USER_ID, ORG_ID), (p) => ({ ...p, se: 0 }));
    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${withEpoch}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
    expect(queryMock).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: "auth.token_type_rejected" }));
  });

  it.each([["password_reset"], ["invite"], ["portal"], ["email_verify"]])("rejects a validly-signed %s-purpose token", async (type) => {
    const t = forge({ sub: USER_ID, org: ORG_ID, role: "admin", se: 0, type, iat: now(), exp: now() + 600 });
    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("legacy untyped session token → 401 session_invalidated, audited", async () => {
    const legacy = forge({ sub: USER_ID, org: ORG_ID, role: "admin", se: 0, iat: now(), exp: now() + 3600 });
    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${legacy}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_invalidated");
    expect(queryMock).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: "auth.session_legacy_untyped" }));
  });

  it("epoch check is still independent: a typed session token WITHOUT se → session_epoch_missing", async () => {
    const t = forge({ sub: USER_ID, org: ORG_ID, role: "admin", type: "session", iat: now(), exp: now() + 3600 });
    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_epoch_missing");
  });
});
