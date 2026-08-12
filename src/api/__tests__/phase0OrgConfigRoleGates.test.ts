/**
 * phase0OrgConfigRoleGates.test.ts — Phase 0 of the enterprise seat program.
 *
 * Organization-wide risk configuration (risk settings, risk scale, risk
 * scoring weights) determines what the whole platform calls critical. Before
 * this change those PUT routes were gated by requireEntitlement("premium")
 * alone — any non-viewer in a premium org could rewrite them. Phase 0 adds
 * requireAdminRole.
 *
 * These tests exercise the REAL requireAdminRole (it is deliberately NOT
 * mocked). Only the upstream middleware is stubbed, so a regression that
 * removes requireAdminRole from any of these chains fails here.
 *
 * Contract of requireAdminRole (src/api/middleware/requireRole.ts):
 *   - JWT admin            → pass
 *   - JWT analyst / viewer → 403 forbidden
 *   - API key (no role)    → pass (API keys are admin-level by convention)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG_ID = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";

// requireApiKey stub: injects req.userRole from the x-test-role header.
// An absent header models API-key auth (role undefined).
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const role = (req as { headers: Record<string, string> }).headers["x-test-role"];
    if (role) (req as { userRole?: string }).userRole = role;
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as { organizationContext?: unknown }).organizationContext = { organizationId: ORG_ID };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
// asTenant passthrough so a handler that IS reached runs (and may 4xx/5xx on
// the stubbed DB — we only assert it is NOT 403).
vi.mock("../middleware/asTenant.js", () => ({
  asTenant: (fn: unknown) => fn,
}));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  pgElevated: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  withTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// requireRole is intentionally REAL.

import riskSettingsRouter from "../routes/riskSettings.js";
import riskScaleRouter from "../routes/riskScale.js";
import riskScoringWeightsRouter from "../routes/riskScoringWeights.js";

function makeApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const CASES: Array<{ label: string; method: "put"; path: string; router: express.Router }> = [
  { label: "risk settings", method: "put", path: "/api/orgs/me/risk-settings", router: riskSettingsRouter },
  { label: "risk scale", method: "put", path: "/api/risk-scale", router: riskScaleRouter },
  { label: "risk scoring weights", method: "put", path: "/api/risk-scoring-weights", router: riskScoringWeightsRouter },
];

describe("Phase 0 — org-wide risk configuration requires admin", () => {
  beforeEach(() => vi.clearAllMocks());

  for (const c of CASES) {
    describe(c.label, () => {
      it("403s a JWT analyst", async () => {
        const res = await request(makeApp(c.router))
          [c.method](c.path)
          .set("x-test-role", "analyst")
          .send({});
        expect(res.status).toBe(403);
      });

      it("403s a JWT viewer", async () => {
        const res = await request(makeApp(c.router))
          [c.method](c.path)
          .set("x-test-role", "viewer")
          .send({});
        expect(res.status).toBe(403);
      });

      it("does not 403 a JWT admin (gate passes to handler)", async () => {
        const res = await request(makeApp(c.router))
          [c.method](c.path)
          .set("x-test-role", "admin")
          .send({});
        expect(res.status).not.toBe(403);
      });

      it("does not 403 an API-key caller (admin-level convention)", async () => {
        const res = await request(makeApp(c.router))[c.method](c.path).send({});
        expect(res.status).not.toBe(403);
      });
    });
  }
});
