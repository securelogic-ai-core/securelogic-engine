/**
 * corePlatformCapability.test.ts — EAR P9 (Track C): the dual-gate.
 * Proves flag-off delegation is byte-identical to requireEntitlement, the
 * flag-on OR-semantics (entitlement passes / grant admits / neither → the
 * ORIGINAL entitlement denial body), the 401 no-context contract, fail-closed
 * on a lookup error, and — source-assert — that all ten core-domain route
 * files mount the dual-gate (with the migration column in lockstep).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));

import { pg } from "../infra/postgres.js";
import type { requireEntitlementOrCapability } from "../lib/corePlatformCapability.js";
import {
  capabilityGatingEnabled,
  requirePremiumOrCorePlatform
} from "../lib/corePlatformCapability.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FLAG = "SECURELOGIC_CAPABILITY_GATING_ENABLED";
const q = pg.query as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0,
    _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function reqFor(entitlement: string | null, orgId: string | null = ORG_A): Request {
  return {
    organizationContext: orgId ? { organizationId: orgId, entitlementLevel: entitlement } : undefined
  } as unknown as Request;
}

async function run(
  gate: ReturnType<typeof requireEntitlementOrCapability>,
  req: Request
): Promise<{ nexted: boolean; res: ReturnType<typeof mockRes> }> {
  const res = mockRes();
  let nexted = false;
  await gate(req, res, (() => { nexted = true; }) as NextFunction);
  return { nexted, res };
}

let prev: string | undefined;
beforeEach(() => {
  q.mockReset();
  prev = process.env[FLAG];
});
afterEach(() => {
  if (prev === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prev;
});

describe("dual-gate — flag OFF (default)", () => {
  it("delegates verbatim: premium passes, starter gets the exact entitlement denial, no DB access", async () => {
    delete process.env[FLAG];
    expect(capabilityGatingEnabled()).toBe(false);

    const pass = await run(requirePremiumOrCorePlatform, reqFor("platform"));
    expect(pass.nexted).toBe(true);

    const deny = await run(requirePremiumOrCorePlatform, reqFor("starter"));
    expect(deny.nexted).toBe(false);
    expect(deny.res._status).toBe(403);
    expect(deny.res._json).toEqual({
      error: "insufficient_entitlement",
      required: "premium",
      current: "starter"
    });
    expect(q).not.toHaveBeenCalled();
  });
});

describe("dual-gate — flag ON", () => {
  beforeEach(() => { process.env[FLAG] = "true"; });

  it("entitlement leg passes without a capability lookup", async () => {
    const { nexted } = await run(requirePremiumOrCorePlatform, reqFor("premium"));
    expect(nexted).toBe(true);
    expect(q).not.toHaveBeenCalled();
  });

  it("explicit grant admits an org the entitlement denies", async () => {
    q.mockResolvedValueOnce({ rows: [{ core_platform_capability: true }], rowCount: 1 });
    const { nexted } = await run(requirePremiumOrCorePlatform, reqFor("professional"));
    expect(nexted).toBe(true);
    expect(q.mock.calls[0]![1]).toEqual([ORG_A]);
  });

  it("NULL and FALSE overrides both fall back to the ORIGINAL entitlement denial", async () => {
    for (const override of [null, false]) {
      q.mockReset();
      q.mockResolvedValueOnce({ rows: [{ core_platform_capability: override }], rowCount: 1 });
      const { nexted, res } = await run(requirePremiumOrCorePlatform, reqFor("starter"));
      expect(nexted, String(override)).toBe(false);
      expect(res._status).toBe(403);
      expect(res._json).toEqual({
        error: "insufficient_entitlement",
        required: "premium",
        current: "starter"
      });
    }
  });

  it("missing org context replays the 401 contract without a capability lookup", async () => {
    const { nexted, res } = await run(requirePremiumOrCorePlatform, reqFor(null, null));
    expect(nexted).toBe(false);
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ error: "api_key_required" });
    expect(q).not.toHaveBeenCalled();
  });

  it("a lookup failure fails CLOSED to the entitlement denial", async () => {
    q.mockRejectedValueOnce(new Error("db down"));
    const { nexted, res } = await run(requirePremiumOrCorePlatform, reqFor("starter"));
    expect(nexted).toBe(false);
    expect(res._status).toBe(403);
    expect(res._json).toMatchObject({ error: "insufficient_entitlement" });
  });
});

describe("adoption + migration lockstep", () => {
  const FILES = [
    "vendors.ts", "aiSystems.ts", "controls.ts", "obligations.ts", "actions.ts",
    "aiGovernanceAssessments.ts", "controlAssessments.ts", "obligationAssessments.ts",
    "governanceReviews.ts", "vendorReviews.ts"
  ];

  it("all ten core-domain route files mount the dual-gate and none keep the bare premium gate", () => {
    for (const f of FILES) {
      const src = readFileSync(path.resolve(HERE, "../routes", f), "utf8");
      expect(src, f).toContain("requirePremiumOrCorePlatform");
      expect(src, f).not.toContain('requireEntitlement("premium")');
    }
  });

  it("the 20260809 migration adds exactly the column the middleware reads", () => {
    const sql = readFileSync(path.resolve(HERE, "../../../db/migrations/20260809_org_core_platform_capability.sql"), "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS core_platform_capability BOOLEAN NULL");
    const mw = readFileSync(path.resolve(HERE, "../lib/corePlatformCapability.ts"), "utf8");
    expect(mw).toContain("core_platform_capability FROM organizations");
  });
});
