/**
 * enterpriseContextCapability.test.ts — Item 9 (GATE A / AD-17). The pure capability
 * resolver + the requireCapability middleware (pg mocked). Database-free.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn() },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));

import { pg } from "../infra/postgres.js";
import { resolveEnterpriseContextCapability, requireCapability } from "../lib/enterpriseContextCapability.js";

const q = pg.query as unknown as ReturnType<typeof vi.fn>;

describe("resolveEnterpriseContextCapability (pure, AD-17)", () => {
  it("explicit override wins over tier (true grants even a starter)", () => {
    expect(resolveEnterpriseContextCapability("starter", true)).toBe(true);
  });
  it("explicit override wins over tier (false denies even Enterprise)", () => {
    expect(resolveEnterpriseContextCapability("enterprise", false)).toBe(false);
  });
  it("NULL override + Platform plan -> granted by default", () => {
    for (const lvl of ["platform", "platform_annual", "premium", "enterprise", "PLATFORM"]) {
      expect(resolveEnterpriseContextCapability(lvl, null)).toBe(true);
    }
  });
  it("NULL override + Brief tiers / starter -> denied by default", () => {
    for (const lvl of ["professional", "team", "teams", "standard", "starter", "", null]) {
      expect(resolveEnterpriseContextCapability(lvl, null)).toBe(false);
    }
  });
});

function mockRes() {
  return {
    _status: 0,
    _json: undefined as unknown,
    status(c: number) { this._status = c; return this; },
    json(b: unknown) { this._json = b; return this; }
  };
}

describe("requireCapability middleware", () => {
  beforeEach(() => q.mockReset());

  function run(ctx: unknown, overrideRow: Array<Record<string, unknown>>) {
    q.mockResolvedValueOnce({ rows: overrideRow, rowCount: overrideRow.length });
    const req = { organizationContext: ctx } as unknown as Request;
    const res = mockRes();
    let nexted = false;
    let nextErr: unknown = null;
    const next: NextFunction = ((e?: unknown) => { nexted = true; nextErr = e ?? null; }) as NextFunction;
    return requireCapability("enterprise_context")(req, res as unknown as Response, next).then(() => ({ res, nexted, nextErr }));
  }

  it("401 when organizationContext is missing", async () => {
    const req = {} as Request;
    const res = mockRes();
    await requireCapability("enterprise_context")(req, res as unknown as Response, (() => {}) as NextFunction);
    expect(res._status).toBe(401);
  });

  it("calls next() when a Platform plan has NULL override (default granted)", async () => {
    const { res, nexted } = await run({ organizationId: "org-1", entitlementLevel: "platform" }, [{ enterprise_context_capability: null }]);
    expect(nexted).toBe(true);
    expect(res._status).toBe(0);
  });

  it("403 capability_required when a Brief tier has NULL override", async () => {
    const { res, nexted } = await run({ organizationId: "org-1", entitlementLevel: "team" }, [{ enterprise_context_capability: null }]);
    expect(nexted).toBe(false);
    expect(res._status).toBe(403);
    expect(res._json).toMatchObject({ error: "capability_required", capability: "enterprise_context" });
  });

  it("explicit per-org grant (true) lets a non-platform org through", async () => {
    const { res, nexted } = await run({ organizationId: "org-1", entitlementLevel: "professional" }, [{ enterprise_context_capability: true }]);
    expect(nexted).toBe(true);
    expect(res._status).toBe(0);
  });

  it("explicit per-org revoke (false) blocks a platform org", async () => {
    const { res } = await run({ organizationId: "org-1", entitlementLevel: "platform" }, [{ enterprise_context_capability: false }]);
    expect(res._status).toBe(403);
  });

  it("forwards a DB error to next(err)", async () => {
    q.mockRejectedValueOnce(new Error("db down"));
    const req = { organizationContext: { organizationId: "org-1", entitlementLevel: "platform" } } as unknown as Request;
    const res = mockRes();
    let nextErr: unknown = null;
    await requireCapability("enterprise_context")(req, res as unknown as Response, ((e?: unknown) => { nextErr = e; }) as NextFunction);
    expect(nextErr).toBeInstanceOf(Error);
  });
});
