/**
 * apiKeySeatBinding.test.ts — activation blocker 2.
 *
 * A bound API key acts AS its issuer's seat/role when the seat model is ON,
 * closing the "API key = admin-level" bypass. With the model OFF, or for a
 * legacy (unbound) key, behaviour is unchanged: no seat/role is attached and
 * the key stays admin-level (requireRole/requireAdminRole pass on "no role").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const keyRow = (over: Record<string, unknown> = {}) => ({
  id: "k1", organization_id: "org1", label: "l", key_hash: "h", status: "active",
  last_used_at: null, created_at: new Date(), revoked_at: null, expires_at: null,
  created_by_user_id: "u1", bound_seat_type: null, bound_role: null, ...over,
});

const queryMock = vi.fn();
vi.mock("../infra/postgres.js", () => ({ pg: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../infra/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../lib/jwt.js", () => ({ verifyJwt: () => null, verifyJwtDetailed: () => ({ ok: false, reason: "bad_signature" }), SESSION_BLOCKED_STATUSES: new Set() }));

import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireAdminRole } from "../middleware/requireRole.js";

function app(row: Record<string, unknown>) {
  queryMock.mockReset();
  // First query = the key lookup; any later (last_used_at update) = noop.
  queryMock.mockImplementation((sql: string) =>
    /FROM api_keys/i.test(sql) ? Promise.resolve({ rows: [row], rowCount: 1 }) : Promise.resolve({ rows: [], rowCount: 0 })
  );
  const a = express();
  a.get("/probe", requireApiKey as express.RequestHandler, (req, res) =>
    res.status(200).json({ role: (req as { userRole?: string }).userRole ?? null, seat: (req as { userSeatType?: string }).userSeatType ?? null })
  );
  return a;
}
const call = (row: Record<string, unknown>) => request(app(row)).get("/probe").set("X-Api-Key", "sl_plainkey");

afterEach(() => vi.unstubAllEnvs());

describe("flag OFF — every key stays admin-level (no role attached)", () => {
  it("a viewer-bound key attaches nothing", async () => {
    const res = await call(keyRow({ bound_seat_type: "viewer", bound_role: "viewer" }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ role: null, seat: null }); // no role ⇒ admin-level downstream
  });
});

describe("flag ON — bound key acts as its issuer", () => {
  beforeEach(() => vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "true"));

  it("a viewer-bound key attaches viewer role + seat", async () => {
    const res = await call(keyRow({ bound_seat_type: "viewer", bound_role: "viewer" }));
    expect(res.body).toEqual({ role: "viewer", seat: "viewer" });
  });

  it("a contributor-bound key attaches contributor seat", async () => {
    const res = await call(keyRow({ bound_seat_type: "contributor", bound_role: "analyst" }));
    expect(res.body).toEqual({ role: "analyst", seat: "contributor" });
  });

  it("a full/admin-bound key attaches admin", async () => {
    const res = await call(keyRow({ bound_seat_type: "full", bound_role: "admin" }));
    expect(res.body).toEqual({ role: "admin", seat: "full" });
  });

  it("a LEGACY key (null binding) attaches nothing — admin-level compat window", async () => {
    const res = await call(keyRow({ bound_seat_type: null, bound_role: null }));
    expect(res.body).toEqual({ role: null, seat: null });
  });

  it("BYPASS CLOSED: a viewer-bound key is refused an admin route", async () => {
    queryMock.mockReset();
    queryMock.mockImplementation((sql: string) =>
      /FROM api_keys/i.test(sql)
        ? Promise.resolve({ rows: [keyRow({ bound_seat_type: "viewer", bound_role: "viewer" })], rowCount: 1 })
        : Promise.resolve({ rows: [], rowCount: 0 })
    );
    const a = express();
    a.get("/admin", requireApiKey as express.RequestHandler, requireAdminRole, (_req, res) => res.status(200).json({ ok: true }));
    const res = await request(a).get("/admin").set("X-Api-Key", "sl_plainkey");
    expect(res.status).toBe(403);
  });

  it("a full/admin-bound key still passes the admin route", async () => {
    queryMock.mockReset();
    queryMock.mockImplementation((sql: string) =>
      /FROM api_keys/i.test(sql)
        ? Promise.resolve({ rows: [keyRow({ bound_seat_type: "full", bound_role: "admin" })], rowCount: 1 })
        : Promise.resolve({ rows: [], rowCount: 0 })
    );
    const a = express();
    a.get("/admin", requireApiKey as express.RequestHandler, requireAdminRole, (_req, res) => res.status(200).json({ ok: true }));
    const res = await request(a).get("/admin").set("X-Api-Key", "sl_plainkey");
    expect(res.status).toBe(200);
  });
});
