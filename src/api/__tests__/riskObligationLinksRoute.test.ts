/**
 * RR-6 — Source-text + behavioral guards for the risk_obligation_links routes.
 *
 * Mechanical mirror of riskControlLinksRoute.test.ts (RR-4) — same shape,
 * same coverage. Asserts route file structure, audit shape, tenant guards,
 * re-link semantics, migration shape, and behavioral re-link/delete cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Mocks must be hoisted before the route module is imported.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn(),
}));

const ROUTE_FILE   = resolve(__dirname, "../routes/riskObligationLinks.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");
const MIGRATION    = resolve(__dirname, "../../../db/migrations/20260606_risk_obligation_links.sql");
const MIGRATION_SOURCE = readFileSync(MIGRATION, "utf8");

// ====================================================================
// Source-text guards — route shape
// ====================================================================

describe("riskObligationLinks.ts — route registration", () => {
  it("declares POST /risks/:id/obligations", () => {
    expect(ROUTE_SOURCE).toMatch(/router\.post\(\s*["']\/risks\/:id\/obligations["']/);
  });

  it("declares DELETE /risks/:id/obligations/:obligationId", () => {
    expect(ROUTE_SOURCE).toMatch(
      /router\.delete\(\s*["']\/risks\/:id\/obligations\/:obligationId["']/
    );
  });

  it("declares GET /risks/:id/obligations", () => {
    expect(ROUTE_SOURCE).toMatch(/router\.get\(\s*["']\/risks\/:id\/obligations["']/);
  });

  it("declares GET /obligations/:id/risks (inverse)", () => {
    expect(ROUTE_SOURCE).toMatch(/router\.get\(\s*["']\/obligations\/:id\/risks["']/);
  });

  it("uses the standard middleware chain on every endpoint", () => {
    const blocks = ROUTE_SOURCE.match(/router\.\w+\([\s\S]+?\);/g) ?? [];
    expect(blocks.length).toBe(4);
    for (const block of blocks) {
      expect(block).toMatch(/requireApiKey/);
      expect(block).toMatch(/attachOrganizationContext/);
      expect(block).toMatch(/requireEntitlement\(["']premium["']\)/);
      expect(block).not.toMatch(/requireAdminRole/);
    }
  });
});

describe("riskObligationLinks.ts — audit event shape", () => {
  it("uses risk_obligation_link.created event_type and resourceType", () => {
    expect(ROUTE_SOURCE).toMatch(/eventType:\s*["']risk_obligation_link\.created["']/);
    expect(ROUTE_SOURCE).toMatch(/resourceType:\s*["']risk_obligation_link["']/);
  });

  it("uses risk_obligation_link.deleted event_type", () => {
    expect(ROUTE_SOURCE).toMatch(/eventType:\s*["']risk_obligation_link\.deleted["']/);
  });

  it("create payload includes risk_id, obligation_id, note", () => {
    const m = ROUTE_SOURCE.match(
      /writeAuditEvent\(\{[\s\S]{0,1500}?eventType:\s*["']risk_obligation_link\.created["'][\s\S]{0,1500}?\}\);/
    );
    expect(m).not.toBeNull();
    const block = m![0];
    expect(block).toMatch(/payload:\s*\{\s*risk_id:[\s\S]*?obligation_id[\s\S]*?note/);
  });

  it("delete payload includes risk_id, obligation_id", () => {
    const m = ROUTE_SOURCE.match(
      /writeAuditEvent\(\{[\s\S]{0,1500}?eventType:\s*["']risk_obligation_link\.deleted["'][\s\S]{0,1500}?\}\);/
    );
    expect(m).not.toBeNull();
    const block = m![0];
    expect(block).toMatch(/payload:\s*\{\s*risk_id[\s\S]*?obligation_id/);
  });

  it("captures actor and ip on every audit event", () => {
    const blocks = ROUTE_SOURCE.match(/writeAuditEvent\(\{[\s\S]+?\}\);/g) ?? [];
    expect(blocks.length).toBe(2);
    for (const block of blocks) {
      expect(block).toMatch(/actorUserId/);
      expect(block).toMatch(/actorApiKeyId/);
      expect(block).toMatch(/ipAddress:\s*req\.ip/);
    }
  });
});

describe("riskObligationLinks.ts — tenant isolation guards", () => {
  it("never reads organization_id from req.body", () => {
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\.organization_id/);
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\?\.organization_id/);
  });

  it("verifies risk same-org before linkage operations", () => {
    expect(ROUTE_SOURCE).toMatch(
      /SELECT 1 FROM risks WHERE id = \$1 AND organization_id = \$2 LIMIT 1/
    );
  });

  it("verifies obligation same-org before linkage operations", () => {
    expect(ROUTE_SOURCE).toMatch(
      /SELECT 1 FROM obligations WHERE id = \$1 AND organization_id = \$2 LIMIT 1/
    );
  });
});

describe("riskObligationLinks.ts — re-link semantics SQL shape", () => {
  it("checks for a live row before any write", () => {
    expect(ROUTE_SOURCE).toMatch(
      /SELECT \$\{LINK_SELECT\}\s+FROM risk_obligation_links[\s\S]+?deleted_at IS NULL/
    );
  });

  it("undeletes a soft-deleted row in place rather than inserting alongside", () => {
    // Same enhancement as RR-4 — at most one row per (org, risk, obligation)
    // ever exists. Asserting the UPDATE shape protects against a future
    // refactor regressing back to INSERT-after-soft-delete.
    expect(ROUTE_SOURCE).toMatch(
      /UPDATE risk_obligation_links\s+SET deleted_at\s*=\s*NULL[\s\S]+?deleted_at IS NOT NULL/
    );
  });

  it("DELETE soft-deletes (UPDATE deleted_at = NOW()), not hard delete", () => {
    expect(ROUTE_SOURCE).toMatch(
      /UPDATE risk_obligation_links\s+SET deleted_at = NOW\(\)[\s\S]+?deleted_at IS NULL/
    );
  });
});

// ====================================================================
// Migration shape guard
// ====================================================================

describe("risk_obligation_links migration", () => {
  it("creates the table with all required columns", () => {
    expect(MIGRATION_SOURCE).toMatch(/CREATE TABLE IF NOT EXISTS risk_obligation_links/);
    for (const col of [
      "id",
      "organization_id",
      "risk_id",
      "obligation_id",
      "note",
      "created_by_user_id",
      "created_at",
      "deleted_at",
    ]) {
      expect(MIGRATION_SOURCE).toContain(col);
    }
  });

  it("organization_id, risk_id, obligation_id are NOT NULL with CASCADE", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /organization_id\s+UUID\s+NOT NULL REFERENCES organizations\(id\) ON DELETE CASCADE/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /risk_id\s+UUID\s+NOT NULL REFERENCES risks\(id\)\s+ON DELETE CASCADE/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /obligation_id\s+UUID\s+NOT NULL REFERENCES obligations\(id\)\s+ON DELETE CASCADE/
    );
  });

  it("created_by_user_id is nullable with ON DELETE SET NULL", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /created_by_user_id\s+UUID\s+NULL\s+REFERENCES users\(id\)\s+ON DELETE SET NULL/
    );
  });

  it("partial unique index excludes soft-deleted rows", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_obligation_links_unique_active[\s\S]+?WHERE deleted_at IS NULL/
    );
  });

  it("declares directional read indexes (forward + inverse)", () => {
    expect(MIGRATION_SOURCE).toMatch(/idx_risk_obligation_links_org_risk[\s\S]+?WHERE deleted_at IS NULL/);
    expect(MIGRATION_SOURCE).toMatch(/idx_risk_obligation_links_org_obligation[\s\S]+?WHERE deleted_at IS NULL/);
  });

  it("uses IF NOT EXISTS on every DDL statement", () => {
    const ddlLines = MIGRATION_SOURCE.match(/CREATE\s+(TABLE|UNIQUE INDEX|INDEX)/g) ?? [];
    expect(ddlLines.length).toBe(4);
    const ifNotExists = MIGRATION_SOURCE.match(/IF NOT EXISTS/g) ?? [];
    expect(ifNotExists.length).toBe(4);
  });
});

// ====================================================================
// Behavioral tests — drive handlers directly with mocked pg
// ====================================================================

import { pg } from "../infra/postgres.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  createRiskObligationLink,
  deleteRiskObligationLink,
} from "../routes/riskObligationLinks.js";

const mockQuery      = pg.query as unknown as ReturnType<typeof vi.fn>;
const mockWriteAudit = writeAuditEvent as unknown as ReturnType<typeof vi.fn>;

const ORG_UUID         = "11111111-1111-4111-8111-111111111111";
const RISK_UUID        = "22222222-2222-4222-8222-222222222222";
const OBLIGATION_UUID  = "33333333-3333-4333-8333-333333333333";
const USER_UUID        = "44444444-4444-4444-8444-444444444444";
const LINK_UUID        = "55555555-5555-5555-8555-555555555555";

function makeReq(body: unknown = {}, params: Record<string, string> = {}): any {
  return {
    body,
    params,
    organizationContext: { organizationId: ORG_UUID },
    userId: USER_UUID,
    apiKey: { id: "ak_test" },
    ip: "127.0.0.1",
    query: {},
  };
}

function makeRes() {
  const r: Record<string, any> = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json   = vi.fn().mockReturnValue(r);
  r.send   = vi.fn().mockReturnValue(r);
  return r as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockWriteAudit.mockReset();
});

describe("createRiskObligationLink — re-link semantics", () => {
  it("returns existing live link with no audit (idempotent no-op)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] })  // risk pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] })  // obligation pre-flight
      .mockResolvedValueOnce({                                             // live row found
        rowCount: 1,
        rows: [{ id: LINK_UUID, risk_id: RISK_UUID, obligation_id: OBLIGATION_UUID, deleted_at: null }],
      });

    const req = makeReq({ obligation_id: OBLIGATION_UUID }, { id: RISK_UUID });
    const res = makeRes();
    await createRiskObligationLink(req, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ created: false, link: expect.any(Object) })
    );
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("undeletes a soft-deleted row and emits .created", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no live row
      .mockResolvedValueOnce({                          // UPDATE undelete found one
        rowCount: 1,
        rows: [{ id: LINK_UUID, risk_id: RISK_UUID, obligation_id: OBLIGATION_UUID, deleted_at: null }],
      });

    const req = makeReq({ obligation_id: OBLIGATION_UUID, note: "back on" }, { id: RISK_UUID });
    const res = makeRes();
    await createRiskObligationLink(req, res as any);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ created: true })
    );
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "risk_obligation_link.created",
        resourceType: "risk_obligation_link",
        resourceId: LINK_UUID,
        payload: expect.objectContaining({
          risk_id: RISK_UUID,
          obligation_id: OBLIGATION_UUID,
          note: "back on",
        }),
      })
    );
    // The UPDATE query (4th mockQuery call) must target the soft-deleted row.
    const updateCall = mockQuery.mock.calls[3]!;
    expect(updateCall[0]).toMatch(/UPDATE risk_obligation_links/);
    expect(updateCall[0]).toMatch(/deleted_at IS NOT NULL/);
  });

  it("inserts a new row when no row exists, emits .created", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no live row
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // undelete missed
      .mockResolvedValueOnce({                          // INSERT
        rowCount: 1,
        rows: [{ id: LINK_UUID, risk_id: RISK_UUID, obligation_id: OBLIGATION_UUID, deleted_at: null }],
      });

    const req = makeReq({ obligation_id: OBLIGATION_UUID }, { id: RISK_UUID });
    const res = makeRes();
    await createRiskObligationLink(req, res as any);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "risk_obligation_link.created" })
    );
  });

  it("returns 404 when risk does not belong to caller's org", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = makeReq({ obligation_id: OBLIGATION_UUID }, { id: RISK_UUID });
    const res = makeRes();
    await createRiskObligationLink(req, res as any);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "risk_not_found" });
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("returns 404 when obligation does not belong to caller's org", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] }) // risk OK
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                 // obligation miss
    const req = makeReq({ obligation_id: OBLIGATION_UUID }, { id: RISK_UUID });
    const res = makeRes();
    await createRiskObligationLink(req, res as any);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "obligation_not_found" });
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("rejects non-UUID risk path param with 400", async () => {
    const req = makeReq({ obligation_id: OBLIGATION_UUID }, { id: "not-a-uuid" });
    const res = makeRes();
    await createRiskObligationLink(req, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects body with non-UUID obligation_id with 400", async () => {
    const req = makeReq({ obligation_id: "not-a-uuid" }, { id: RISK_UUID });
    const res = makeRes();
    await createRiskObligationLink(req, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("deleteRiskObligationLink", () => {
  it("soft-deletes a live link and emits .deleted", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: LINK_UUID, risk_id: RISK_UUID, obligation_id: OBLIGATION_UUID, deleted_at: "2026-05-07" }],
    });

    const req = makeReq({}, { id: RISK_UUID, obligationId: OBLIGATION_UUID });
    const res = makeRes();
    await deleteRiskObligationLink(req, res as any);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "risk_obligation_link.deleted",
        resourceId: LINK_UUID,
        payload: { risk_id: RISK_UUID, obligation_id: OBLIGATION_UUID },
      })
    );

    const updateCall = mockQuery.mock.calls[0]!;
    expect(updateCall[0]).toMatch(/UPDATE risk_obligation_links/);
    expect(updateCall[0]).toMatch(/SET deleted_at = NOW\(\)/);
    expect(updateCall[0]).toMatch(/deleted_at IS NULL/);
    expect(updateCall[1]).toEqual([ORG_UUID, RISK_UUID, OBLIGATION_UUID]);
  });

  it("returns 404 with no audit when no live link exists", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = makeReq({}, { id: RISK_UUID, obligationId: OBLIGATION_UUID });
    const res = makeRes();
    await deleteRiskObligationLink(req, res as any);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "risk_obligation_link_not_found" });
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("rejects non-UUID risk param with 400", async () => {
    const req = makeReq({}, { id: "not-uuid", obligationId: OBLIGATION_UUID });
    const res = makeRes();
    await deleteRiskObligationLink(req, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects non-UUID obligationId param with 400", async () => {
    const req = makeReq({}, { id: RISK_UUID, obligationId: "not-uuid" });
    const res = makeRes();
    await deleteRiskObligationLink(req, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
