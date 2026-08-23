/**
 * requirementGuidanceRoleGates.test.ts — the 2026-08-23 ruling: vendor-facing
 * questionnaire guidance is GOVERNED CONTENT, and creation carries the same
 * authorization boundary as curation.
 *
 * POST /api/requirements shipped without requireAdminRole while the curation
 * PATCH carried it — so any non-viewer, non-contributor member could author
 * the exact text the admin gate protects on edit. The operator ruled the
 * asymmetry unintentional: both writes now require the org-admin role, using
 * the SAME primitive (no new role invented).
 *
 * These tests exercise the REAL requireAdminRole (deliberately NOT mocked),
 * following the phase0OrgConfigRoleGates pattern: only upstream middleware is
 * stubbed, so a regression that removes requireAdminRole from either chain
 * fails here.
 *
 * Contract of requireAdminRole (src/api/middleware/requireRole.ts):
 *   - JWT admin            → pass
 *   - JWT analyst / viewer → 403 forbidden
 *   - API key (no role)    → pass (API keys are admin-level by convention —
 *     the platform-wide R9 caveat, documented, not widened here)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG_ID = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const REQ_ID = "bbbbbbbb-2222-4333-8444-cccccccccccc";

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
// The seat gate is census-covered by seatRouteCoverage.test.ts; here it is a
// passthrough so the ONLY deny that can fire is the role gate under test.
vi.mock("../middleware/requireSeat.js", () => ({
  denyContributor: () => (_req: unknown, _res: unknown, next: () => void) => next(),
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

import requirementsRouter from "../routes/requirements.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", requirementsRouter);
  return app;
}

const WRITES: Array<{
  label: string;
  send: (app: express.Express, role?: string) => request.Test;
}> = [
  {
    label: "POST /api/requirements (creation)",
    send: (app, role) => {
      const r = request(app)
        .post("/api/requirements")
        .send({ framework_id: REQ_ID, reference_id: "GOV-1", title: "Governed" });
      return role ? r.set("x-test-role", role) : r;
    },
  },
  {
    label: "PATCH /api/requirements/:id (curation)",
    send: (app, role) => {
      const r = request(app)
        .patch(`/api/requirements/${REQ_ID}`)
        .send({ description: "guidance text" });
      return role ? r.set("x-test-role", role) : r;
    },
  },
];

describe("requirement guidance writes require admin — creation and curation alike", () => {
  beforeEach(() => vi.clearAllMocks());

  for (const w of WRITES) {
    it(`${w.label}: JWT analyst is refused with 403`, async () => {
      const res = await w.send(makeApp(), "analyst");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("forbidden");
    });

    it(`${w.label}: JWT viewer is refused with 403`, async () => {
      const res = await w.send(makeApp(), "viewer");
      expect(res.status).toBe(403);
    });

    it(`${w.label}: JWT admin passes the role gate`, async () => {
      const res = await w.send(makeApp(), "admin");
      // Downstream may 4xx/5xx against the stubbed DB — the assertion is
      // only that the ROLE gate did not refuse.
      expect(res.status).not.toBe(403);
    });

    it(`${w.label}: API-key auth (no role) passes — the documented R9 posture`, async () => {
      const res = await w.send(makeApp());
      expect(res.status).not.toBe(403);
    });
  }
});
