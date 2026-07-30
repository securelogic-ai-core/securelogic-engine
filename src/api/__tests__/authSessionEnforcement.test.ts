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
  const actual = await importOriginal<typeof import("../lib/jwt.js")>();
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
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes("FROM users")) {
      return Promise.resolve({ rows: userRow ? [userRow] : [], rowCount: userRow ? 1 : 0 });
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
  jwtPayload = { sub: USER_ID, org: ORG_ID, role: "admin", iat: NOW_S, exp: NOW_S + 3600 };
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
    // The gate must run before the JWT is signed.
    expect(source.indexOf("SESSION_BLOCKED_STATUSES.has(u.status)")).toBeLessThan(
      source.indexOf("signJwt(userId, orgId, userRole)")
    );
  });

  it("the existing-user lookup selects status", () => {
    expect(source).toMatch(/SELECT id, name, email, role, organization_id, status\s+FROM users/);
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
