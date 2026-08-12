/**
 * contributorRouteScoping.test.ts — Phase 3a route wiring (PROGRAM STOP GATE).
 *
 * Proves that findings/actions/evidence routes enforce Contributor scope
 * through the real router code: a non-owned detail is 404 (non-disclosing), an
 * owned detail is reachable, and governance/aggregate routes 403 a Contributor.
 * The SQL-level row isolation (list/cross-user/cross-tenant) is proven against a
 * real database in contributorScopingIsolation.test.ts.
 *
 * pg is controllable so we can hand a handler a row owned by someone else and
 * assert the route refuses to disclose it. The seat model flag is ON.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const ME = "11111111-1111-4111-8111-111111111111"; // the contributor making the request
const OTHER = "22222222-2222-4222-8222-222222222222"; // a different user

const queryMock = vi.fn();

// Controllable DB.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: (...a: unknown[]) => queryMock(...a) },
  pgElevated: { query: (...a: unknown[]) => queryMock(...a) },
  withTenant: (_o: string, fn: () => unknown) => fn(),
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// asTenant passthrough.
vi.mock("../middleware/asTenant.js", () => ({ asTenant: (fn: unknown) => fn }));
// Auth: inject identity + seat from headers.
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const h = (req as { headers: Record<string, string> }).headers;
    if (h["x-user"]) (req as { userId?: string }).userId = h["x-user"];
    if (h["x-role"]) (req as { userRole?: string }).userRole = h["x-role"];
    if (h["x-seat"]) (req as { userSeatType?: string }).userSeatType = h["x-seat"];
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as { organizationContext?: unknown }).organizationContext = { organizationId: ORG };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/corePlatformCapability.js", () => ({
  requirePremiumOrCorePlatform: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireEntitlementOrCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import findingsRouter from "../routes/findings.js";
import actionsRouter from "../routes/actions.js";
import evidenceRouter from "../routes/evidence.js";
import vendorsRouter from "../routes/vendors.js";
import controlAssessmentsRouter from "../routes/controlAssessments.js";

function app(router: express.Router) {
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return a;
}
const asContributor = (r: request.Test) =>
  r.set("x-user", ME).set("x-role", "analyst").set("x-seat", "contributor");

beforeEach(() => {
  queryMock.mockReset();
  vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("detail routes — non-owned is 404 (non-disclosing)", () => {
  it("GET /findings/:id owned by another user → 404", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "f2", owner_user_id: OTHER, title: "secret" }] });
    const res = await asContributor(request(app(findingsRouter)).get("/api/findings/33333333-3333-4333-8333-333333333333"));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("GET /findings/:id owned by me → not 404", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "f1", owner_user_id: ME, title: "mine" }] });
    const res = await asContributor(request(app(findingsRouter)).get("/api/findings/33333333-3333-4333-8333-333333333333"));
    expect(res.status).toBe(200);
  });

  it("GET /actions/:id owned by another user → 404", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "a2", owner_user_id: OTHER, title: "secret" }] });
    const res = await asContributor(request(app(actionsRouter)).get("/api/actions/33333333-3333-4333-8333-333333333333"));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("GET /evidence/:id uploaded by another user → 404", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "e2", uploaded_by_user_id: OTHER, title: "secret" }] });
    const res = await asContributor(request(app(evidenceRouter)).get("/api/evidence/33333333-3333-4333-8333-333333333333"));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("GET /vendors/:id owned by another user → 404", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "v2", owner_user_id: OTHER, name: "secret" }] });
    const res = await asContributor(request(app(vendorsRouter)).get("/api/vendors/33333333-3333-4333-8333-333333333333"));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("GET /control-assessments/:id assigned to another user → 404 (assignment guard)", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ assigned_to_user_id: OTHER }] });
    const res = await asContributor(request(app(controlAssessmentsRouter)).get("/api/control-assessments/33333333-3333-4333-8333-333333333333"));
    expect(res.status).toBe(404);
  });

  it("GET /control-assessments/:id assigned to me → not 404", async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ assigned_to_user_id: ME }] });
    const res = await asContributor(request(app(controlAssessmentsRouter)).get("/api/control-assessments/33333333-3333-4333-8333-333333333333"));
    expect(res.status).not.toBe(404);
  });
});

describe("governance / aggregate routes — Contributor 403 (before any DB access)", () => {
  const cases: Array<[string, express.Router, "get" | "post", string]> = [
    ["GET /findings/summary", findingsRouter, "get", "/api/findings/summary"],
    ["GET /findings/by-entity", findingsRouter, "get", "/api/findings/by-entity?entity_type=vendor&entity_id=x"],
    ["POST /findings (create)", findingsRouter, "post", "/api/findings"],
    ["POST /findings/bulk", findingsRouter, "post", "/api/findings/bulk"],
    ["GET /actions/summary", actionsRouter, "get", "/api/actions/summary"],
    ["POST /actions (create)", actionsRouter, "post", "/api/actions"],
    ["GET /evidence/summary", evidenceRouter, "get", "/api/evidence/summary"],
    ["GET /evidence/recent", evidenceRouter, "get", "/api/evidence/recent"],
    ["GET /vendors/summary", vendorsRouter, "get", "/api/vendors/summary"],
    ["POST /vendors (create)", vendorsRouter, "post", "/api/vendors"],
    ["GET /vendors/export.csv", vendorsRouter, "get", "/api/vendors/export.csv"],
    ["POST /control-assessments (create)", controlAssessmentsRouter, "post", "/api/control-assessments"],
  ];
  for (const [label, router, method, path] of cases) {
    it(`${label} → 403 seat_not_permitted`, async () => {
      const res = await asContributor(request(app(router))[method](path).send({}));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("seat_not_permitted");
      expect(queryMock).not.toHaveBeenCalled();
    });
  }
});

describe("with the flag OFF — byte-identical passthrough", () => {
  it("a contributor detail read is NOT forced to 404 (gate inert)", async () => {
    vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "false");
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: "f2", owner_user_id: OTHER, title: "x" }] });
    const res = await asContributor(request(app(findingsRouter)).get("/api/findings/33333333-3333-4333-8333-333333333333"));
    expect(res.status).toBe(200); // flag off ⇒ no ownership enforcement
  });

  it("summary is NOT denied to a contributor when the flag is off", async () => {
    vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "false");
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    const res = await asContributor(request(app(findingsRouter)).get("/api/findings/summary"));
    expect(res.status).not.toBe(403);
  });
});
