/**
 * viewerSeatReadOnly.test.ts — release-review fix (P1).
 *
 * A Viewer SEAT is read-only regardless of the paired role. Before the fix the
 * mutation chokepoint keyed on the raw role only, so an incompatible
 * (viewer seat, analyst role) pair — permitted by provisioning — could write.
 * Now the chokepoint blocks a viewer seat too (flag on), on BOTH the JWT-bridge
 * and the bound-API-key paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.fn();
const verifyJwtMock = vi.fn();

vi.mock("../infra/postgres.js", () => ({ pg: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../infra/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../lib/jwt.js", () => ({ verifyJwt: (...a: unknown[]) => verifyJwtMock(...a), SESSION_BLOCKED_STATUSES: new Set() }));

import { requireApiKey } from "../middleware/requireApiKey.js";

function makeApp() {
  const a = express();
  a.use(express.json());
  a.post("/mutate", requireApiKey as express.RequestHandler, (_req, res) => res.status(200).json({ ok: true }));
  a.get("/read", requireApiKey as express.RequestHandler, (_req, res) => res.status(200).json({ ok: true }));
  return a;
}

beforeEach(() => { queryMock.mockReset(); verifyJwtMock.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

describe("JWT bridge — a Viewer SEAT with a non-viewer role cannot mutate (flag on)", () => {
  beforeEach(() => {
    vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "true");
    // JWT verifies; the user row is an incompatible viewer-seat + analyst-role.
    // SEC-JWT-EPOCH: a real session carries `se`; the row carries the matching
    // epoch, so this fixture exercises seat/role logic rather than tripping the
    // epoch gate.
    verifyJwtMock.mockReturnValue({ sub: "u1", se: 0, iat: Math.floor(Date.now() / 1000) });
    queryMock.mockImplementation((sql: string) => {
      if (/password_changed_at, status, role, seat_type/.test(sql))
        return Promise.resolve({ rows: [{ password_changed_at: null, status: "active", role: "analyst", seat_type: "viewer", session_epoch: 0 }] });
      if (/FROM api_keys/.test(sql)) return Promise.resolve({ rows: [{ id: "k", organization_id: "o", status: "active" }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  it("POST is refused (read_only_access)", async () => {
    const res = await request(makeApp()).post("/mutate").set("Authorization", "Bearer a.b.c").send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("read_only_access");
  });

  it("GET is still allowed", async () => {
    const res = await request(makeApp()).get("/read").set("Authorization", "Bearer a.b.c");
    expect(res.status).toBe(200);
  });
});

describe("bound API key — a Viewer-bound key cannot mutate (flag on)", () => {
  beforeEach(() => {
    vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "true");
    queryMock.mockImplementation((sql: string) =>
      /FROM api_keys/.test(sql)
        ? Promise.resolve({ rows: [{ id: "k", organization_id: "o", status: "active", revoked_at: null, expires_at: null, bound_seat_type: "viewer", bound_role: "viewer" }], rowCount: 1 })
        : Promise.resolve({ rows: [], rowCount: 0 })
    );
  });

  it("POST with a viewer-bound key is refused", async () => {
    const res = await request(makeApp()).post("/mutate").set("X-Api-Key", "sl_plain").send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("read_only_access");
  });
});
