/**
 * ssoExchangeRoute.test.ts — route-level contract for POST /api/sso/exchange
 * (security review N3).
 *
 * Drives the real sso router via supertest with the code store and the user
 * lookup mocked, so the assertions are about the ROUTE's security contract:
 * flag-off darkness, uniform errors, role-and-status read at exchange time,
 * and the audit trail at the mint site.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const CODE = "a".repeat(64);

const h = vi.hoisted(() => ({
  consume: vi.fn(),
  userRows: [] as Array<{ role: string; status: string | null }>,
}));

vi.mock("express-rate-limit", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
  ipKeyGenerator: (ip: string) => ip,
}));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(async () => ({ rows: [] })) },
  pgElevated: {
    query: vi.fn(async (sql: string) =>
      /FROM users/.test(sql) ? { rows: h.userRows } : { rows: [] }
    ),
    connect: vi.fn(),
  },
}));
vi.mock("../lib/jwt.js", () => ({
  signJwt: vi.fn(() => "signed.jwt.token"),
  verifyJwt: vi.fn(() => ({ sub: USER, org: ORG, role: "admin", type: "session", iat: 0, exp: 9_999_999_999 })),
  verifyJwtDetailed: vi.fn(() => ({ ok: true, payload: { sub: USER, org: ORG, role: "admin", type: "session", iat: 0, exp: 9_999_999_999 } })),
  SESSION_BLOCKED_STATUSES: new Set(["inactive", "pending_deletion", "deleted"]),
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../lib/ssoLoginCodes.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSsoLoginCode: vi.fn(),
    consumeSsoLoginCode: h.consume,
  };
});

import express from "express";
import request from "supertest";
import ssoRouter from "../routes/sso.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const FLAG = "SECURELOGIC_SSO_CODE_EXCHANGE_ENABLED";
const audit = writeAuditEvent as unknown as ReturnType<typeof vi.fn>;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", ssoRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.userRows = [{ role: "analyst", status: "active" }];
  h.consume.mockResolvedValue({
    organizationId: ORG,
    userId: USER,
    email: "sso@a.test",
    displayName: "Sso User",
  });
  process.env[FLAG] = "true";
});

afterEach(() => {
  delete process.env[FLAG];
});

describe("POST /api/sso/exchange — darkness", () => {
  it("flag off → 404, and the code is never consumed", async () => {
    delete process.env[FLAG];
    const res = await request(makeApp()).post("/api/sso/exchange").send({ code: CODE });
    expect(res.status).toBe(404);
    expect(h.consume).not.toHaveBeenCalled();
    // Security review #710 finding 1: flag-off must be indistinguishable from
    // a route that does not exist — the app-wide 404 body (incl. `path`) and
    // no RateLimit-* headers (the flag gate runs BEFORE the limiter).
    expect(res.body).toEqual({ error: "not_found", path: "/api/sso/exchange" });
    expect(res.headers["ratelimit-limit"]).toBeUndefined();
    expect(res.headers["ratelimit-remaining"]).toBeUndefined();
  });
});

describe("POST /api/sso/exchange — happy path", () => {
  it("returns the token + identity and audits the mint", async () => {
    const res = await request(makeApp()).post("/api/sso/exchange").send({ code: CODE });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: "signed.jwt.token",
      userId: USER,
      email: "sso@a.test",
      name: "Sso User",
      orgId: ORG,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "auth.sso_login_exchanged",
        organizationId: ORG,
        actorUserId: USER,
      })
    );
  });
});

describe("POST /api/sso/exchange — uniform failure surface", () => {
  it("missing/blank/non-string code → 400 without consuming", async () => {
    for (const body of [{}, { code: "" }, { code: 42 }]) {
      const res = await request(makeApp()).post("/api/sso/exchange").send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "code_required" });
    }
    expect(h.consume).not.toHaveBeenCalled();
  });

  it("unknown / expired / replayed code → identical 401 invalid_code", async () => {
    h.consume.mockResolvedValue(null);
    const res = await request(makeApp()).post("/api/sso/exchange").send({ code: CODE });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_code" });
  });

  it("a code whose user vanished → the SAME 401, no token", async () => {
    h.userRows = [];
    const res = await request(makeApp()).post("/api/sso/exchange").send({ code: CODE });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_code" });
  });
});

describe("POST /api/sso/exchange — status gate at the mint site (review B2 + #732)", () => {
  it("inactive / pending_deletion / deleted users get the uniform 401 and a blocked-login audit", async () => {
    for (const status of ["inactive", "pending_deletion", "deleted"]) {
      vi.clearAllMocks();
      h.userRows = [{ role: "admin", status }];
      h.consume.mockResolvedValue({
        organizationId: ORG,
        userId: USER,
        email: "sso@a.test",
        displayName: "Sso User",
      });

      const res = await request(makeApp()).post("/api/sso/exchange").send({ code: CODE });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "invalid_code" });
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "auth.login_blocked",
          resourceId: USER,
          payload: expect.objectContaining({ reason: status }),
        })
      );
      // No session was minted for a deleted account.
      expect(audit).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "auth.sso_login_exchanged" })
      );
    }
  });
});

describe("POST /api/sso/exchange — role is read at exchange time", () => {
  it("the CURRENT role is signed, not one captured when the code was minted", async () => {
    const { signJwt } = await import("../lib/jwt.js");
    h.userRows = [{ role: "admin", status: "active", session_epoch: 4 }];

    await request(makeApp()).post("/api/sso/exchange").send({ code: CODE });

    // SEC-JWT-EPOCH: the epoch is read at exchange time alongside role and
    // status, so a reset between code issue and redemption invalidates rather
    // than mints.
    expect(signJwt).toHaveBeenCalledWith(USER, ORG, "admin", 4);
  });
});
