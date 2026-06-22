/**
 * RR-5 — Behavioral + structural tests for the risk_settings route.
 *
 * Two layers:
 *   1. source-text guards on routes/riskSettings.ts (mirrors
 *      riskScoringWeights.test.ts pattern) — confirm middleware, audit
 *      event type, ON CONFLICT upsert, no body-sourced organization_id.
 *   2. behavioral tests of getRiskSettings + putRiskSettings handlers
 *      with mocked pg + mocked writeAuditEvent. Focus areas:
 *         - GET returns is_default:true when no row exists
 *         - GET returns merged (defaults + stored) cadence map
 *         - PUT happy path: SELECT-before-write diff (DEV-RS1), audit
 *           event includes cadence_diff with { before, after } map
 *         - PUT first-time write: before = effective defaults (so audit
 *           records the real change rather than null→{...})
 *         - PUT validation failure: 400, no DB write, no audit
 *         - missing org context: 403
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn(),
}));

import { pg } from "../infra/postgres.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  getRiskSettings,
  putRiskSettings,
  buildEffectiveCadenceByRating,
} from "../routes/riskSettings.js";
import { DEFAULT_CADENCE_BY_RATING } from "../lib/riskCadence.js";

const mockQuery       = pg.query as unknown as ReturnType<typeof vi.fn>;
const mockWriteAudit  = writeAuditEvent as unknown as ReturnType<typeof vi.fn>;

const VALID_ORG_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_ROW_UUID = "22222222-2222-4222-8222-222222222222";

function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json   = vi.fn().mockReturnValue(res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

// =====================================================================
// Source-text route guards
// =====================================================================

const ROUTE_FILE   = resolve(__dirname, "../routes/riskSettings.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("riskSettings route — tenant isolation invariants", () => {
  it("imports requireApiKey middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*requireApiKey/);
  });

  it("imports attachOrganizationContext middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*attachOrganizationContext/);
  });

  it("gates on premium entitlement", () => {
    expect(ROUTE_SOURCE).toMatch(/requireEntitlement\(["']premium["']\)/);
  });

  it("never reads organization_id from req.body", () => {
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\.organization_id/);
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\?\.organization_id/);
  });

  it("sources organizationId from req.organizationContext", () => {
    expect(ROUTE_SOURCE).toMatch(/organizationContext/);
  });

  it("declares GET and PUT endpoints at /orgs/me/risk-settings", () => {
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/orgs\/me\/risk-settings["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.put\(\s*["']\/orgs\/me\/risk-settings["']/
    );
  });

  it("PUT uses ON CONFLICT (organization_id) DO UPDATE — single row per org", () => {
    expect(ROUTE_SOURCE).toMatch(
      /ON CONFLICT \(organization_id\)\s+DO UPDATE/
    );
  });

  it("audit-logs PUT with risk_settings.updated event type", () => {
    expect(ROUTE_SOURCE).toMatch(/writeAuditEvent/);
    expect(ROUTE_SOURCE).toMatch(/risk_settings\.updated/);
  });

  it("PUT performs SELECT-before-write to capture diff baseline (DEV-RS1)", () => {
    // The before-snapshot SELECT should query risk_settings by org id
    // so the audit payload can include a per-key { before, after } diff.
    expect(ROUTE_SOURCE).toMatch(
      /SELECT cadence_by_rating[\s\S]*FROM risk_settings[\s\S]*WHERE organization_id\s*=\s*\$1/
    );
  });

  it("PUT audit payload includes a cadence_diff key (DEV-RS1)", () => {
    expect(ROUTE_SOURCE).toMatch(/cadence_diff/);
  });
});

// =====================================================================
// Behavioral — GET handler
// =====================================================================

describe("riskSettings — GET handler", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns 200 with is_default:true when no row exists", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = {
      organizationContext: { organizationId: VALID_ORG_UUID },
    } as unknown as Parameters<typeof getRiskSettings>[0];
    const res = makeRes();

    await getRiskSettings(
      req,
      res as unknown as Parameters<typeof getRiskSettings>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        is_default: true,
        organization_id: VALID_ORG_UUID,
        cadence_by_rating: DEFAULT_CADENCE_BY_RATING,
      })
    );
  });

  it("returns 200 with is_default:false when a row exists, merged with defaults", async () => {
    // Stored policy only specifies Critical and High; Moderate and Low
    // should fall through to documented defaults.
    const stored = {
      id: VALID_ROW_UUID,
      organization_id: VALID_ORG_UUID,
      cadence_by_rating: { Critical: 14, High: 45 },
      created_at: "2026-05-05T00:00:00.000Z",
      updated_at: "2026-05-05T01:00:00.000Z",
      updated_by_user_id: null,
    };
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [stored] });

    const req = {
      organizationContext: { organizationId: VALID_ORG_UUID },
    } as unknown as Parameters<typeof getRiskSettings>[0];
    const res = makeRes();

    await getRiskSettings(
      req,
      res as unknown as Parameters<typeof getRiskSettings>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        is_default: false,
        organization_id: VALID_ORG_UUID,
        cadence_by_rating: {
          Critical: 14,
          High: 45,
          Moderate: DEFAULT_CADENCE_BY_RATING.Moderate,
          Low: DEFAULT_CADENCE_BY_RATING.Low,
        },
      })
    );
  });

  it("missing org context returns 403 organization_context_missing", async () => {
    const req = {} as unknown as Parameters<typeof getRiskSettings>[0];
    const res = makeRes();

    await getRiskSettings(
      req,
      res as unknown as Parameters<typeof getRiskSettings>[1]
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "organization_context_missing" })
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Behavioral — PUT handler
// =====================================================================

describe("riskSettings — PUT handler", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWriteAudit.mockReset();
  });

  function validBody() {
    return {
      cadence_by_rating: {
        Critical: 14, High: 30, Moderate: 60, Low: 120,
      },
    };
  }

  it("happy path: returns 200, audit payload includes cadence_diff against prior row", async () => {
    // First query: SELECT-before-write returns prior row.
    mockQuery
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ cadence_by_rating: { Critical: 30, High: 60, Moderate: 90, Low: 180 } }],
      })
      // Second query: INSERT … ON CONFLICT … DO UPDATE returns the row.
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: VALID_ROW_UUID,
          organization_id: VALID_ORG_UUID,
          cadence_by_rating: validBody().cadence_by_rating,
          created_at: "2026-05-05T00:00:00.000Z",
          updated_at: "2026-05-05T00:00:00.000Z",
          updated_by_user_id: null,
        }],
      });

    const req = {
      body: validBody(),
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1",
    } as unknown as Parameters<typeof putRiskSettings>[0];
    const res = makeRes();

    await putRiskSettings(
      req,
      res as unknown as Parameters<typeof putRiskSettings>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        is_default: false,
        organization_id: VALID_ORG_UUID,
        cadence_by_rating: validBody().cadence_by_rating,
      })
    );
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const auditCall = mockWriteAudit.mock.calls[0]![0]! as {
      eventType: string;
      resourceType: string;
      organizationId: string;
      payload: { cadence_by_rating: unknown; cadence_diff: { before: Record<string, number>; after: Record<string, number> } };
    };
    expect(auditCall.eventType).toBe("risk_settings.updated");
    expect(auditCall.resourceType).toBe("risk_settings");
    expect(auditCall.organizationId).toBe(VALID_ORG_UUID);
    expect(auditCall.payload.cadence_by_rating).toEqual(validBody().cadence_by_rating);
    // Diff should include all four keys (every value changed) with
    // before = prior values and after = new values.
    expect(auditCall.payload.cadence_diff.before).toEqual({
      Critical: 30, High: 60, Moderate: 90, Low: 180,
    });
    expect(auditCall.payload.cadence_diff.after).toEqual({
      Critical: 14, High: 30, Moderate: 60, Low: 120,
    });
  });

  it("first-time write: before = effective defaults (DEV-RS1)", async () => {
    // SELECT-before-write returns no row → before should be the
    // documented defaults map, not null. This makes the very first
    // PUT auditable as a real transition rather than a black box.
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: VALID_ROW_UUID,
          organization_id: VALID_ORG_UUID,
          cadence_by_rating: validBody().cadence_by_rating,
          created_at: "2026-05-05T00:00:00.000Z",
          updated_at: "2026-05-05T00:00:00.000Z",
          updated_by_user_id: null,
        }],
      });

    const req = {
      body: validBody(),
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1",
    } as unknown as Parameters<typeof putRiskSettings>[0];
    const res = makeRes();

    await putRiskSettings(
      req,
      res as unknown as Parameters<typeof putRiskSettings>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const auditCall = mockWriteAudit.mock.calls[0]![0]! as {
      payload: { cadence_diff: { before: Record<string, number>; after: Record<string, number> } };
    };
    expect(auditCall.payload.cadence_diff.before).toEqual(DEFAULT_CADENCE_BY_RATING);
    expect(auditCall.payload.cadence_diff.after).toEqual(validBody().cadence_by_rating);
  });

  it("audit diff only includes keys whose value changed", async () => {
    // Prior row matches what we're submitting except Critical changed
    // from 30 → 14. The diff should only contain Critical.
    const stored = { Critical: 30, High: 30, Moderate: 60, Low: 120 };
    const submit = { Critical: 14, High: 30, Moderate: 60, Low: 120 };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ cadence_by_rating: stored }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: VALID_ROW_UUID,
          organization_id: VALID_ORG_UUID,
          cadence_by_rating: submit,
          created_at: "2026-05-05T00:00:00.000Z",
          updated_at: "2026-05-05T00:00:00.000Z",
          updated_by_user_id: null,
        }],
      });

    const req = {
      body: { cadence_by_rating: submit },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1",
    } as unknown as Parameters<typeof putRiskSettings>[0];
    const res = makeRes();

    await putRiskSettings(
      req,
      res as unknown as Parameters<typeof putRiskSettings>[1]
    );

    const auditCall = mockWriteAudit.mock.calls[0]![0]! as {
      payload: { cadence_diff: { before: Record<string, number>; after: Record<string, number> } };
    };
    expect(auditCall.payload.cadence_diff.before).toEqual({ Critical: 30 });
    expect(auditCall.payload.cadence_diff.after).toEqual({ Critical: 14 });
  });

  it("invalid body returns 400 without hitting pg or audit", async () => {
    const req = {
      body: { cadence_by_rating: { Critical: 30 } }, // missing keys
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1",
    } as unknown as Parameters<typeof putRiskSettings>[0];
    const res = makeRes();

    await putRiskSettings(
      req,
      res as unknown as Parameters<typeof putRiskSettings>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("missing org context returns 403 (no DB or audit)", async () => {
    const req = {
      body: validBody(),
      ip: "127.0.0.1",
    } as unknown as Parameters<typeof putRiskSettings>[0];
    const res = makeRes();

    await putRiskSettings(
      req,
      res as unknown as Parameters<typeof putRiskSettings>[1]
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});

// =====================================================================
// buildEffectiveCadenceByRating — pure helper
// =====================================================================

describe("buildEffectiveCadenceByRating", () => {
  it("returns documented defaults when stored is null", () => {
    expect(buildEffectiveCadenceByRating(null)).toEqual(DEFAULT_CADENCE_BY_RATING);
  });

  it("merges stored values over defaults (partial maps)", () => {
    expect(buildEffectiveCadenceByRating({ Critical: 7, High: 20 })).toEqual({
      Critical: 7,
      High: 20,
      Moderate: DEFAULT_CADENCE_BY_RATING.Moderate,
      Low: DEFAULT_CADENCE_BY_RATING.Low,
    });
  });

  it("ignores stored values that are not positive integers", () => {
    expect(
      buildEffectiveCadenceByRating({ Critical: 0, High: -5, Moderate: "90" })
    ).toEqual(DEFAULT_CADENCE_BY_RATING);
  });

  it("ignores stored values that are NaN/Infinity/non-integers", () => {
    expect(
      buildEffectiveCadenceByRating({
        Critical: Number.NaN,
        High: Number.POSITIVE_INFINITY,
        Moderate: 7.5,
      })
    ).toEqual(DEFAULT_CADENCE_BY_RATING);
  });
});
