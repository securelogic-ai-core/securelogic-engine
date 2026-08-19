/**
 * authSessionEnforcement.test.ts — live-session enforcement on both JWT
 * verification paths, closing the gap where member removal and role
 * changes did not take effect until natural token expiry (up to 7 days):
 *
 *   - requireApiKey JWT bridge: blocked statuses → 401, hard-deleted row
 *     → 401, DB role beats the stale token claim (both directions),
 *     password-recency and fail-closed semantics preserved;
 *   - requireAuth: blocked statuses → 401, fresh role attached,
 *     fail-open on DB error preserved;
 *   - source guards: the login route blocks 'inactive' users and
 *     change-password enforces the full password policy.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "fs";
import { resolve } from "path";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const ORG_ID  = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const NOW_S   = Math.floor(Date.now() / 1000);

const queryMock = vi.fn();
let jwtPayload: Record<string, unknown> | null = null;

vi.mock("../infra/postgres.js", () => ({
  pg: { query: (...args: unknown[]) => queryMock(...args) },
  withTenant: vi.fn(),
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn(),
}));
vi.mock("../lib/jwt.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, verifyJwt: () => jwtPayload };
});

import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const JWT_TOKEN = "aaa.bbb.ccc"; // dots → JWT bridge path

function bridgeApp() {
  const app = express();
  app.get("/probe", requireApiKey, (req, res) => {
    res.json({ ok: true, role: req.userRole });
  });
  app.post("/probe", requireApiKey, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function authApp() {
  const app = express();
  app.get("/probe", requireAuth, (req, res) => {
    res.json({ ok: true, role: req.jwtPayload?.role });
  });
  return app;
}

/** users-row lookup answered first, api_keys second, rest fire-and-forget. */
function primeDb(userRow: Record<string, unknown> | null) {
  // SEC-JWT-EPOCH: every users row carries an epoch (NOT NULL DEFAULT 0), so
  // the fixture defaults it. Cases that exercise the epoch pass it explicitly.
  const row = userRow === null ? null : { session_epoch: 0, ...userRow };
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes("FROM users")) {
      return Promise.resolve({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
    }
    if (sql.includes("FROM api_keys")) {
      return Promise.resolve({
        rows: [{ id: "key-1", organization_id: ORG_ID, status: "active" }],
        rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => {
  queryMock.mockReset();
  vi.mocked(writeAuditEvent).mockClear();
  jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 0, iat: NOW_S, exp: NOW_S + 3600 };
});

describe("requireApiKey JWT bridge — live-session enforcement", () => {
  it("blocks a removed member (status='inactive') with 401 and an audit event", async () => {
    primeDb({ password_changed_at: null, status: "inactive", role: "admin" });

    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("account_inactive");
    expect(vi.mocked(writeAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "auth.session_blocked_inactive" })
    );
  });

  it("blocks deletion-lifecycle statuses", async () => {
    for (const status of ["pending_deletion", "deleted"]) {
      primeDb({ password_changed_at: null, status, role: "admin" });
      const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("account_inactive");
    }
  });

  it("blocks a hard-deleted user row", async () => {
    primeDb(null);
    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("account_inactive");
  });

  it("role DOWNGRADE takes effect immediately: DB viewer beats stale admin claim on mutations", async () => {
    jwtPayload = { ...jwtPayload!, role: "admin" };
    primeDb({ password_changed_at: null, status: "active", role: "viewer" });

    const res = await request(bridgeApp()).post("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("read_only_access");
  });

  it("role change is reflected in req.userRole for downstream authz", async () => {
    jwtPayload = { ...jwtPayload!, role: "viewer" };
    primeDb({ password_changed_at: null, status: "active", role: "admin" });

    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("admin");
  });

  it("still rejects tokens issued before the last password change", async () => {
    primeDb({
      password_changed_at: new Date((NOW_S + 100) * 1000),
      status: "active",
      role: "admin",
    });

    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_invalidated");
  });

  it("still fails CLOSED (503) when the users lookup errors", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("FROM users")) return Promise.reject(new Error("db down"));
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("auth_unavailable");
  });
});

describe("requireAuth — live-session enforcement", () => {
  it("blocks a removed member with 401", async () => {
    primeDb({ password_changed_at: null, status: "inactive", role: "admin" });

    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("account_inactive");
  });

  it("attaches the CURRENT DB role, not the token claim", async () => {
    jwtPayload = { ...jwtPayload!, role: "admin" };
    primeDb({ password_changed_at: null, status: "active", role: "viewer" });

    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("viewer");
  });

  it("still fails OPEN on DB error (availability over freshness on auth routes)", async () => {
    queryMock.mockImplementation(() => Promise.reject(new Error("db down")));

    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);

    expect(res.status).toBe(200);
  });
});

describe("sso source guards", () => {
  const source = readFileSync(resolve(__dirname, "../routes/sso.ts"), "utf8");

  it("ACS blocks SESSION_BLOCKED_STATUSES before reissuing a session", () => {
    expect(source).toMatch(/SESSION_BLOCKED_STATUSES\.has\(u\.status\)/);
    expect(source).toMatch(/error=account_inactive/);
    // The gate must run before the JWT is signed. Matched by regex rather than
    // an exact literal so adding a signJwt argument (e.g. the session epoch)
    // cannot silently turn this ordering assertion into indexOf() === -1.
    const signIdx = source.search(/signJwt\(userId, orgId, userRole\b/);
    expect(signIdx).toBeGreaterThan(-1);
    expect(source.indexOf("SESSION_BLOCKED_STATUSES.has(u.status)")).toBeLessThan(signIdx);
  });

  it("the existing-user lookup selects status", () => {
    expect(source).toMatch(/SELECT id, name, email, role, organization_id, status[^`]*FROM users/);
  });

  it("the existing-user lookup also selects session_epoch, and both ACS branches set it", () => {
    expect(source).toMatch(/SELECT id, name, email, role, organization_id, status, session_epoch/);
    // Both the existing-user and JIT branches must resolve an epoch, or a
    // session could be minted under a defaulted 0 and die on the next request.
    expect(source).toMatch(/userEpoch = u\.session_epoch/);
    expect(source).toMatch(/userEpoch\s*=\s*inserted\.rows\[0\]!\.session_epoch/);
    expect(source).toMatch(/signJwt\(userId, orgId, userRole, userEpoch\)/);
  });
});

describe("customerAuth source guards", () => {
  const source = readFileSync(resolve(__dirname, "../routes/customerAuth.ts"), "utf8");

  it("login blocks status='inactive' before the password check", () => {
    expect(source).toMatch(/user\.status === "inactive"/);
    expect(source).toMatch(/error:\s*"account_inactive"/);
    // The gate must run before password verification.
    expect(source.indexOf('user.status === "inactive"')).toBeLessThan(
      source.indexOf("argon2.verify(hash")
    );
  });

  it("change-password enforces the full password policy, not length only", () => {
    const block = source.match(/\/auth\/change-password[\s\S]{0,1600}/)![0];
    expect(block).toMatch(/validatePassword\(newRaw\)/);
    expect(block).not.toMatch(/newRaw\.length < 12/);
  });
});

/* =========================================================
   SEC-JWT-EPOCH — deterministic session invalidation
   =========================================================

   The epoch replaces a comparison that could not be made correct by tuning:

     payload.iat < Math.floor(password_changed_at_ms / 1000)

   `iat` has 1-second resolution; the invalidation event does not. With a
   change at T+0.5s the boundary floors to T, so a token minted at T+0.2s —
   BEFORE the change — satisfied `T < T` === false and was ACCEPTED. Rounding
   up instead closes that hole but rejects a session minted at T+0.6s, right
   AFTER the change. No rounding satisfies both, so the comparison is replaced
   by integer equality against users.session_epoch.

   Absence of `se` is invalid session state, NOT a compatibility fallback. */

describe("SEC-JWT-EPOCH — requireAuth", () => {
  it("MISSING epoch (token predates the change) → 401 session_epoch_missing", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: null, status: "active", role: "admin", session_epoch: 0 });
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_epoch_missing");
  });

  it("MISSING epoch is rejected WITHOUT consulting the database", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: null, status: "active", role: "admin", session_epoch: 0 });
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);
    expect(res.status).toBe(401);
    // Pure function of the token: no users lookup was issued at all.
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("STALE epoch (user reset since issue) → 401 session_invalidated", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 3, iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: null, status: "active", role: "admin", session_epoch: 4 });
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_invalidated");
  });

  it("CURRENT epoch → allowed", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 7, iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: null, status: "active", role: "admin", session_epoch: 7 });
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("a FUTURE-numbered epoch is not accepted either (equality, not >=)", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 9, iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: null, status: "active", role: "admin", session_epoch: 7 });
    expect((await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`)).status).toBe(401);
  });

  it("epoch 0 is a VALID epoch, not a missing one", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 0, iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: null, status: "active", role: "admin", session_epoch: 0 });
    expect((await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`)).status).toBe(200);
  });

  it("closes the sub-second bypass: same-second token, epoch already bumped", async () => {
    // iat === floor(password_changed_at) — the exact case the legacy check let
    // through, because `iat < floor(pca)` is false when they are equal.
    const pca = new Date(NOW_S * 1000 + 500); // change landed at NOW_S + 0.5s
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 0, iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: pca, status: "active", role: "admin", session_epoch: 1 });
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_invalidated");
  });
});

describe("SEC-JWT-EPOCH — requireApiKey JWT bridge mirrors requireAuth", () => {
  it("MISSING epoch → 401 session_epoch_missing + audit event", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: null, status: "active", role: "admin", seat_type: "full", session_epoch: 0 });
    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_epoch_missing");
    expect(vi.mocked(writeAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "auth.session_epoch_missing" })
    );
  });

  it("STALE epoch → 401", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 1, iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: null, status: "active", role: "admin", seat_type: "full", session_epoch: 2 });
    expect((await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`)).status).toBe(401);
  });

  it("CURRENT epoch → allowed", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 2, iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: null, status: "active", role: "admin", seat_type: "full", session_epoch: 2 });
    expect((await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`)).status).toBe(200);
  });
});

describe("SEC-JWT-EPOCH — DB-error behaviour is DISTINCT from missing-epoch", () => {
  /* These two failure modes must never be conflated. requireAuth fails OPEN on
     a users-lookup error (availability over freshness, pre-existing and
     deliberate). If the epoch check sat after that lookup, a DB outage would
     turn every missing-epoch token into an ACCEPT — reinstating exactly the
     fail-open behaviour this package removes. It is checked before the query
     instead, so the two are independent. */

  it("MISSING epoch + DB error → still 401 (does NOT inherit fail-open)", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", iat: NOW_S, exp: NOW_S + 3600 };
    queryMock.mockRejectedValue(new Error("connection terminated"));
    const res = await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_epoch_missing");
  });

  it("PRESENT epoch + DB error → requireAuth still fails OPEN (unchanged)", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 0, iat: NOW_S, exp: NOW_S + 3600 };
    queryMock.mockRejectedValue(new Error("connection terminated"));
    expect((await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`)).status).toBe(200);
  });

  it("MISSING epoch + DB error → bridge 401, not its 503 fail-closed path", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", iat: NOW_S, exp: NOW_S + 3600 };
    queryMock.mockRejectedValue(new Error("connection terminated"));
    const res = await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("session_epoch_missing");
  });

  it("PRESENT epoch + DB error → bridge still fails CLOSED with 503 (unchanged)", async () => {
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 0, iat: NOW_S, exp: NOW_S + 3600 };
    queryMock.mockRejectedValue(new Error("connection terminated"));
    expect((await request(bridgeApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`)).status).toBe(503);
  });
});

describe("SEC-JWT-EPOCH — reset / global re-login / new-session issuance", () => {
  const AUTH = readFileSync(resolve(__dirname, "../routes/customerAuth.ts"), "utf8");
  const SEED = readFileSync(
    resolve(__dirname, "../../../scripts/validation/seed-walkthrough-org.ts"), "utf8");

  it("password reset bumps the epoch in the same statement as the credential", () => {
    expect(AUTH).toMatch(/password_reset_token = NULL[\s\S]{0,200}session_epoch = session_epoch \+ 1/);
  });

  it("change-password bumps the epoch and mints the fresh session under the NEW value", () => {
    expect(AUTH).toMatch(/session_epoch = session_epoch \+ 1[\s\S]{0,120}RETURNING session_epoch/);
    expect(AUTH).toMatch(/signJwt\(userId, orgId, req\.jwtPayload!\.role, newEpoch\)/);
  });

  it("the seed reset bumps the epoch — re-hashing the password alone never invalidated anything", () => {
    expect(SEED).toMatch(/session_epoch\s*=\s*users\.session_epoch \+ 1/);
  });

  it("every signJwt call site passes an epoch — no session is minted under the default", () => {
    const files = ["../routes/customerAuth.ts", "../routes/sso.ts", "../routes/mfa.ts", "../routes/teamInvites.ts"];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      for (const call of src.match(/signJwt\([^)]*\)/g) ?? []) {
        expect(call.split(",").length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("a session minted immediately after a reset is valid — no second-boundary race", async () => {
    // Reset bumps 0 -> 1 and the new token is minted under 1 in the same
    // instant. Under the old iat comparison this was a coin-flip on whether
    // the fresh session survived; here it is exact.
    jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", se: 1, iat: NOW_S, exp: NOW_S + 3600 };
    primeDb({ password_changed_at: new Date(NOW_S * 1000 + 500), status: "active", role: "admin", session_epoch: 1 });
    expect((await request(authApp()).get("/probe").set("Authorization", `Bearer ${JWT_TOKEN}`)).status).toBe(200);
  });
});
