/**
 * riskSettingsSlaAudit.test.ts — the remediation SLA change is auditable as a
 * CHANGE (SL-SLA-UI).
 *
 * The SLA governs remediation deadlines, so the question an auditor asks is
 * "when did the deadline for High findings change, and from what?". Recording
 * only the new map answers what the policy is NOW and not what changed — which
 * is the one question an audit trail exists for. The cadence policy beside it
 * already emitted a before/after diff; the SLA did not.
 *
 * Two null cases carry real meaning and must not be collapsed into an empty
 * map: null BEFORE means the org had no due-date automation at all and its
 * findings were created with no deadline; null AFTER means the policy was
 * cleared, which stops future findings getting one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const query = vi.fn();
const STORED: { sla: Record<string, number> | null; cadence: Record<string, number> } = {
  sla: null,
  cadence: { Critical: 30, High: 60, Moderate: 90, Low: 180 },
};

vi.mock("../infra/postgres.js", () => ({
  pg: { query: (sql: string, params?: unknown[]) => query(sql, params ?? []) },
  pgElevated: { query: (sql: string, params?: unknown[]) => query(sql, params ?? []) },
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const audit: Array<Record<string, unknown>> = [];
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: (e: Record<string, unknown>) => { audit.push(e); },
  writeAuditEventAwaited: async (e: Record<string, unknown>) => { audit.push(e); return true; },
}));

vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: express.Request, _r: express.Response, next: express.NextFunction) => {
    (req as unknown as Record<string, unknown>).apiKey = { id: "k-1" };
    (req as unknown as Record<string, unknown>).userId = "u-1";
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: express.Request, _r: express.Response, next: express.NextFunction) => {
    (req as unknown as Record<string, unknown>).organizationContext = { organizationId: "org-1" };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_q: express.Request, _r: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../middleware/requireSeat.js", () => ({
  denyContributor: () => (_q: express.Request, _r: express.Response, next: express.NextFunction) => next(),
}));
// asTenant opens a REAL withTenant transaction via pg.connect(), which this
// suite does not provide — the handler would never run. Tenant scoping is
// proven by the route's own org predicate and by the isolation harness; this
// file is about the audit payload.
vi.mock("../middleware/asTenant.js", () => ({
  asTenant: (h: express.RequestHandler) => h,
}));
vi.mock("../middleware/requireRole.js", () => ({
  requireAdminRole: (_q: express.Request, _r: express.Response, next: express.NextFunction) => next(),
  requireRole: () => (_q: express.Request, _r: express.Response, next: express.NextFunction) => next(),
}));

import router from "../routes/riskSettings.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return a;
}

const put = async (body: Record<string, unknown>) => {
  const r = await request(app()).put("/api/orgs/me/risk-settings").send({
    cadence_by_rating: STORED.cadence,
    ...body,
  });
  return r;
};

const slaDiff = () =>
  (audit.find((e) => e.eventType === "risk_settings.updated")?.payload as
    Record<string, unknown> | undefined)?.["finding_sla_diff"] as
    { before: Record<string, number | null> | null; after: Record<string, number | null> | null } | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  audit.length = 0;
  STORED.sla = null;
  query.mockImplementation(async (sql: string) => {
    if (/SELECT cadence_by_rating, finding_sla_by_severity/i.test(sql)) {
      return { rows: [{ cadence_by_rating: STORED.cadence, finding_sla_by_severity: STORED.sla }], rowCount: 1 };
    }
    if (/INSERT INTO risk_settings/i.test(sql)) {
      return {
        rows: [{
          id: "rs-1", cadence_by_rating: STORED.cadence, finding_sla_by_severity: STORED.sla,
          require_finding_closure_sod: false, require_evidence_gate: false,
          created_at: "2026-01-01", updated_at: "2026-01-02", updated_by_user_id: "u-1",
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
});

describe("the SLA change is recorded as a change", () => {
  it("turning the policy ON records null → the new days, per severity", async () => {
    STORED.sla = null;

    const res = await put({ finding_sla_by_severity: { Critical: 7, High: 14, Moderate: 30, Low: 90 } });

    expect(res.status).toBe(200);
    expect(slaDiff()).toEqual({
      before: { Critical: null, High: null, Moderate: null, Low: null },
      after:  { Critical: 7, High: 14, Moderate: 30, Low: 90 },
    });
  });

  it("changing one severity records only that one", async () => {
    STORED.sla = { Critical: 7, High: 14, Moderate: 30, Low: 90 };

    await put({ finding_sla_by_severity: { Critical: 7, High: 5, Moderate: 30, Low: 90 } });

    expect(slaDiff()).toEqual({ before: { High: 14 }, after: { High: 5 } });
  });

  it("turning the policy OFF records the days → null", async () => {
    // The change that matters most: from here on, new findings get no deadline.
    STORED.sla = { Critical: 7, High: 14, Moderate: 30, Low: 90 };

    await put({ finding_sla_by_severity: null });

    expect(slaDiff()).toEqual({
      before: { Critical: 7, High: 14, Moderate: 30, Low: 90 },
      after:  { Critical: null, High: null, Moderate: null, Low: null },
    });
  });

  it("a no-op write records no phantom diff", async () => {
    STORED.sla = { Critical: 7, High: 14, Moderate: 30, Low: 90 };

    await put({ finding_sla_by_severity: { Critical: 7, High: 14, Moderate: 30, Low: 90 } });

    expect(slaDiff()).toEqual({ before: {}, after: {} });
  });

  it("clearing an already-absent policy invents nothing", async () => {
    STORED.sla = null;

    await put({ finding_sla_by_severity: null });

    expect(slaDiff()).toEqual({ before: null, after: null });
  });

  it("a cadence-only save carries NO sla diff — absent means unchanged", async () => {
    // The endpoint distinguishes "field absent" (leave the stored policy alone)
    // from "explicit null" (clear it). An audit row claiming an SLA change on a
    // cadence-only save would be a false record.
    STORED.sla = { Critical: 7, High: 14, Moderate: 30, Low: 90 };

    await put({});

    const payload = audit.find((e) => e.eventType === "risk_settings.updated")?.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("finding_sla_diff");
    expect(payload).not.toHaveProperty("finding_sla_by_severity");
    expect(payload).toHaveProperty("cadence_diff");
  });
});

describe("the audit row is tenant-attributed", () => {
  it("carries the org, the actor and the settings row", async () => {
    await put({ finding_sla_by_severity: { Critical: 7, High: 14, Moderate: 30, Low: 90 } });

    expect(audit[0]).toMatchObject({
      organizationId: "org-1",
      actorUserId: "u-1",
      eventType: "risk_settings.updated",
      resourceType: "risk_settings",
      resourceId: "rs-1",
    });
  });
});
