/**
 * accountMeSeatScope.test.ts — Phase 7: /api/me exposes the resolved seat
 * scope, the single source of truth the UI consumes (API/UI consistency).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const queryMock = vi.fn();

vi.mock("../infra/postgres.js", () => ({ pg: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../infra/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as { apiKey?: unknown }).apiKey = { id: "k1", organization_id: ORG };
    const h = (req as { headers: Record<string, string> }).headers;
    if (h["x-seat"]) (req as { userSeatType?: string }).userSeatType = h["x-seat"];
    if (h["x-role"]) (req as { userRole?: string }).userRole = h["x-role"];
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as { organizationContext?: unknown }).organizationContext = { organizationId: ORG, viewerExportEnabled: false };
    next();
  },
}));

import accountRouter from "../routes/account.js";

function app() {
  const a = express();
  a.use("/api", accountRouter);
  return a;
}
beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({
    rows: [{ organization_id: ORG, organization_name: "Acme", organization_slug: "acme", organization_plan: "platform", organization_status: "active", entitlement_level: "premium", api_key_id: "k1", api_key_label: "l", api_key_status: "active", stripe_subscription_tier: "platform", payment_failed_at: null, last_used_at: null, api_key_created_at: null }],
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/me — seat scope", () => {
  it("a JWT contributor resolves to assigned scope, not admin", async () => {
    const res = await request(app()).get("/api/me").set("x-seat", "contributor").set("x-role", "analyst");
    expect(res.status).toBe(200);
    expect(res.body.seat.seatType).toBe("contributor");
    expect(res.body.seat.isAdmin).toBe(false);
    expect(res.body.seat.readScope).toBe("assigned");
    expect(res.body.seat.capabilities).not.toContain("export:data");
  });

  it("a Full admin resolves to isAdmin with governance capabilities", async () => {
    const res = await request(app()).get("/api/me").set("x-seat", "full").set("x-role", "admin");
    expect(res.body.seat.isAdmin).toBe(true);
    expect(res.body.seat.capabilities).toEqual(expect.arrayContaining(["users:manage", "export:data"]));
  });

  it("a Full analyst is full-governance but NOT admin (Full ≠ Admin)", async () => {
    const res = await request(app()).get("/api/me").set("x-seat", "full").set("x-role", "analyst");
    expect(res.body.seat.isAdmin).toBe(false);
    expect(res.body.seat.writeScope).toBe("tenant");
    expect(res.body.seat.capabilities).not.toContain("users:manage");
  });

  it("an API-key caller (no seat headers) resolves admin-level full", async () => {
    const res = await request(app()).get("/api/me");
    expect(res.body.seat.seatType).toBe("full");
    expect(res.body.seat.isAdmin).toBe(true);
  });

  it("exposes whether the seat model is enforced in this environment", async () => {
    const off = await request(app()).get("/api/me").set("x-seat", "viewer").set("x-role", "viewer");
    expect(off.body.seat.enforced).toBe(false);
    vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "true");
    const on = await request(app()).get("/api/me").set("x-seat", "viewer").set("x-role", "viewer");
    expect(on.body.seat.enforced).toBe(true);
  });
});
