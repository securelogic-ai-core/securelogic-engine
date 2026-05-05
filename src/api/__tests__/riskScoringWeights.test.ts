import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { validateRiskScoringWeightsPut } from "../lib/riskScoringWeightsValidation.js";
import { DEFAULT_WEIGHTS } from "../lib/riskScoring.js";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() }
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn()
}));

const VALID_ORG_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_ROW_UUID = "22222222-2222-4222-8222-222222222222";

function validBody() {
  return {
    entity_criticality_weights: {
      critical: 1.0,
      high: 0.75,
      medium: 0.5,
      low: 0.25
    },
    obligation_priority_weights: {
      immediate: 1.0,
      near_term: 0.75,
      planned: 0.5,
      watch: 0.25
    },
    severity_weights: {
      Critical: 1.0,
      High: 0.75,
      Moderate: 0.5,
      Low: 0.25
    }
  };
}

// ====================================================================
// Validator — body shape
// ====================================================================

describe("validateRiskScoringWeightsPut — body shape", () => {
  it("rejects null body", () => {
    const r = validateRiskScoringWeightsPut(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateRiskScoringWeightsPut([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateRiskScoringWeightsPut("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("accepts the documented default body", () => {
    const r = validateRiskScoringWeightsPut(validBody());
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.entity_criticality_weights).toEqual(
        DEFAULT_WEIGHTS.entity_criticality_weights
      );
    }
  });
});

// ====================================================================
// Validator — top-level field presence
// ====================================================================

describe("validateRiskScoringWeightsPut — required top-level fields", () => {
  it("rejects body without entity_criticality_weights", () => {
    const b = validBody() as Partial<ReturnType<typeof validBody>>;
    delete b.entity_criticality_weights;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("entity_criticality_weights_required");
  });

  it("rejects body without obligation_priority_weights", () => {
    const b = validBody() as Partial<ReturnType<typeof validBody>>;
    delete b.obligation_priority_weights;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_priority_weights_required");
  });

  it("rejects body without severity_weights", () => {
    const b = validBody() as Partial<ReturnType<typeof validBody>>;
    delete b.severity_weights;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("severity_weights_required");
  });
});

// ====================================================================
// Validator — entity_criticality_weights map
// ====================================================================

describe("validateRiskScoringWeightsPut — entity_criticality_weights map", () => {
  it("rejects non-object", () => {
    const b = validBody();
    (b as Record<string, unknown>).entity_criticality_weights = "nope";
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("entity_criticality_weights_must_be_object");
  });

  it("rejects missing key", () => {
    const b = validBody();
    delete (b.entity_criticality_weights as Record<string, unknown>).medium;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("entity_criticality_weights_missing_keys");
  });

  it("rejects extra key", () => {
    const b = validBody();
    (b.entity_criticality_weights as Record<string, unknown>).insane = 0.5;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("entity_criticality_weights_unexpected_keys");
  });

  it("rejects PascalCase keys (severity vocabulary leaking into entity)", () => {
    // 'High' is severity vocabulary; entity criticality uses 'high'. Validator
    // MUST reject this — collapsing the vocabularies is a bug surface.
    const r = validateRiskScoringWeightsPut({
      ...validBody(),
      entity_criticality_weights: {
        Critical: 1.0,
        High: 0.75,
        Medium: 0.5,
        Low: 0.25
      }
    });
    expect("error" in r).toBe(true);
    if ("error" in r) {
      // The PascalCase keys are unexpected; lowercase keys are missing.
      // First failure surfaced is 'missing keys' (we check missing before
      // extra in the validator); either error-code is correct as long as
      // the body is rejected.
      expect(
        r.error === "entity_criticality_weights_missing_keys" ||
          r.error === "entity_criticality_weights_unexpected_keys"
      ).toBe(true);
    }
  });

  it("rejects zero value (boundary: zero excluded)", () => {
    const b = validBody();
    (b.entity_criticality_weights as Record<string, unknown>).low = 0;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("entity_criticality_weights_value_out_of_range");
  });

  it("rejects negative value", () => {
    const b = validBody();
    (b.entity_criticality_weights as Record<string, unknown>).low = -0.1;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("entity_criticality_weights_value_out_of_range");
  });

  it("rejects value greater than 1", () => {
    const b = validBody();
    (b.entity_criticality_weights as Record<string, unknown>).critical = 1.0001;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("entity_criticality_weights_value_out_of_range");
  });

  it("accepts value exactly 1.0 (upper bound included)", () => {
    const b = validBody();
    (b.entity_criticality_weights as Record<string, unknown>).critical = 1.0;
    const r = validateRiskScoringWeightsPut(b);
    expect("input" in r).toBe(true);
  });

  it("rejects non-number value", () => {
    const b = validBody();
    (b.entity_criticality_weights as Record<string, unknown>).low = "0.25";
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("entity_criticality_weights_value_must_be_number");
  });

  it("rejects NaN", () => {
    const b = validBody();
    (b.entity_criticality_weights as Record<string, unknown>).low = NaN;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("entity_criticality_weights_value_must_be_number");
  });

  it("rejects Infinity", () => {
    const b = validBody();
    (b.entity_criticality_weights as Record<string, unknown>).low =
      Number.POSITIVE_INFINITY;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("entity_criticality_weights_value_must_be_number");
  });
});

// ====================================================================
// Validator — obligation_priority_weights map
// ====================================================================

describe("validateRiskScoringWeightsPut — obligation_priority_weights map", () => {
  it("rejects missing key", () => {
    const b = validBody();
    delete (b.obligation_priority_weights as Record<string, unknown>).immediate;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("obligation_priority_weights_missing_keys");
  });

  it("rejects extra key", () => {
    const b = validBody();
    (b.obligation_priority_weights as Record<string, unknown>).later = 0.1;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("obligation_priority_weights_unexpected_keys");
  });

  it("rejects out-of-range value", () => {
    const b = validBody();
    (b.obligation_priority_weights as Record<string, unknown>).immediate = 1.5;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("obligation_priority_weights_value_out_of_range");
  });
});

// ====================================================================
// Validator — severity_weights map (PascalCase vocabulary)
// ====================================================================

describe("validateRiskScoringWeightsPut — severity_weights map (PascalCase)", () => {
  it("rejects missing 'Moderate' key", () => {
    const b = validBody();
    delete (b.severity_weights as Record<string, unknown>).Moderate;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("severity_weights_missing_keys");
  });

  it("rejects 'Medium' key (entity vocabulary leaking into severity)", () => {
    const b = validBody();
    delete (b.severity_weights as Record<string, unknown>).Moderate;
    (b.severity_weights as Record<string, unknown>).Medium = 0.5;
    const r = validateRiskScoringWeightsPut(b);
    expect("error" in r).toBe(true);
    // Either "missing Moderate" or "unexpected Medium" — both are correct
    // rejections; we check one is present.
    if ("error" in r) {
      expect(
        r.error === "severity_weights_missing_keys" ||
          r.error === "severity_weights_unexpected_keys"
      ).toBe(true);
    }
  });

  it("rejects all-lowercase keys", () => {
    const r = validateRiskScoringWeightsPut({
      ...validBody(),
      severity_weights: { critical: 1.0, high: 0.75, moderate: 0.5, low: 0.25 }
    });
    expect("error" in r).toBe(true);
  });

  it("accepts canonical PascalCase keys", () => {
    const r = validateRiskScoringWeightsPut(validBody());
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(Object.keys(r.input.severity_weights).sort()).toEqual(
        ["Critical", "High", "Low", "Moderate"]
      );
    }
  });
});

// ====================================================================
// Validator — happy path (no organization_id leak)
// ====================================================================

describe("validateRiskScoringWeightsPut — organization_id never echoed", () => {
  it("ignores organization_id supplied in body", () => {
    const r = validateRiskScoringWeightsPut({
      ...validBody(),
      organization_id: "00000000-0000-0000-0000-000000000000"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(Object.keys(r.input).sort()).toEqual(
        [
          "entity_criticality_weights",
          "obligation_priority_weights",
          "severity_weights"
        ].sort()
      );
    }
  });
});

// ====================================================================
// Structural source guards for the route file
// ====================================================================

const ROUTE_FILE = resolve(__dirname, "../routes/riskScoringWeights.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("riskScoringWeights route — tenant isolation invariants", () => {
  it("imports requireApiKey middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*requireApiKey/);
  });

  it("imports attachOrganizationContext middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*attachOrganizationContext/);
  });

  it("gates on standard entitlement", () => {
    expect(ROUTE_SOURCE).toMatch(/requireEntitlement\(["']standard["']\)/);
  });

  it("never reads organization_id from req.body", () => {
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\.organization_id/);
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\?\.organization_id/);
  });

  it("sources organizationId from req.organizationContext", () => {
    expect(ROUTE_SOURCE).toMatch(/organizationContext/);
  });

  it("audit-logs PUT via writeAuditEvent", () => {
    expect(ROUTE_SOURCE).toMatch(/writeAuditEvent/);
    expect(ROUTE_SOURCE).toMatch(/risk_scoring_weights\.updated/);
  });

  it("declares GET and PUT endpoints", () => {
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/risk-scoring-weights["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.put\(\s*["']\/risk-scoring-weights["']/
    );
  });

  it("PUT uses ON CONFLICT (organization_id) DO UPDATE — single row per org", () => {
    expect(ROUTE_SOURCE).toMatch(
      /ON CONFLICT \(organization_id\)\s+DO UPDATE/
    );
  });
});

// ====================================================================
// Migration shape guard
// ====================================================================

const MIGRATION_FILE = resolve(
  __dirname,
  "../../../db/migrations/20260505_risk_scoring_weights.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_FILE, "utf8");

describe("risk_scoring_weights migration", () => {
  it("creates the risk_scoring_weights table", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE TABLE IF NOT EXISTS risk_scoring_weights/
    );
  });

  it("organization_id is NOT NULL and references organizations(id)", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /organization_id\s+UUID\s+NOT NULL\s+REFERENCES organizations\(id\)/
    );
  });

  it("has UNIQUE (organization_id) for one row per org", () => {
    expect(MIGRATION_SOURCE).toMatch(/UNIQUE \(organization_id\)/);
  });

  it("declares all three weight JSONB columns NOT NULL", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /entity_criticality_weights\s+JSONB\s+NOT NULL/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /obligation_priority_weights\s+JSONB\s+NOT NULL/
    );
    expect(MIGRATION_SOURCE).toMatch(/severity_weights\s+JSONB\s+NOT NULL/);
  });

  it("documents the two-vocabulary design in the migration comment", () => {
    expect(MIGRATION_SOURCE).toMatch(/two-vocabulary design/i);
    expect(MIGRATION_SOURCE).toMatch(/PascalCase[\s\S]*Critical[\s\S]*Moderate/);
  });
});

// ====================================================================
// Behavioral tests — GET and PUT
// ====================================================================

import { pg } from "../infra/postgres.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  getRiskScoringWeights,
  putRiskScoringWeights
} from "../routes/riskScoringWeights.js";

const mockQuery = pg.query as unknown as ReturnType<typeof vi.fn>;
const mockWriteAudit = writeAuditEvent as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe("riskScoringWeights — GET handler", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns 200 with is_default:true when no row exists", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = {
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof getRiskScoringWeights>[0];
    const res = makeRes();

    await getRiskScoringWeights(
      req,
      res as unknown as Parameters<typeof getRiskScoringWeights>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        is_default: true,
        organization_id: VALID_ORG_UUID,
        weights: DEFAULT_WEIGHTS
      })
    );
  });

  it("returns 200 with is_default:false when a row exists", async () => {
    const stored = {
      id: VALID_ROW_UUID,
      organization_id: VALID_ORG_UUID,
      entity_criticality_weights: { critical: 1.0, high: 0.6, medium: 0.4, low: 0.1 },
      obligation_priority_weights: { immediate: 1.0, near_term: 0.8, planned: 0.4, watch: 0.1 },
      severity_weights: { Critical: 1.0, High: 0.7, Moderate: 0.4, Low: 0.1 },
      created_at: "2026-05-05T00:00:00.000Z",
      updated_at: "2026-05-05T01:00:00.000Z",
      updated_by_user_id: null
    };
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [stored] });

    const req = {
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof getRiskScoringWeights>[0];
    const res = makeRes();

    await getRiskScoringWeights(
      req,
      res as unknown as Parameters<typeof getRiskScoringWeights>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        is_default: false,
        organization_id: VALID_ORG_UUID,
        weights: {
          entity_criticality_weights: stored.entity_criticality_weights,
          obligation_priority_weights: stored.obligation_priority_weights,
          severity_weights: stored.severity_weights
        }
      })
    );
  });

  it("missing org context returns 403 organization_context_missing", async () => {
    const req = {} as unknown as Parameters<typeof getRiskScoringWeights>[0];
    const res = makeRes();

    await getRiskScoringWeights(
      req,
      res as unknown as Parameters<typeof getRiskScoringWeights>[1]
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "organization_context_missing" })
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("riskScoringWeights — PUT handler", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWriteAudit.mockReset();
  });

  it("happy path: returns 200 with the upserted row, audit event includes weights", async () => {
    const upserted = {
      id: VALID_ROW_UUID,
      organization_id: VALID_ORG_UUID,
      entity_criticality_weights: validBody().entity_criticality_weights,
      obligation_priority_weights: validBody().obligation_priority_weights,
      severity_weights: validBody().severity_weights,
      created_at: "2026-05-05T00:00:00.000Z",
      updated_at: "2026-05-05T00:00:00.000Z",
      updated_by_user_id: null
    };
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [upserted] });

    const req = {
      body: validBody(),
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof putRiskScoringWeights>[0];
    const res = makeRes();

    await putRiskScoringWeights(
      req,
      res as unknown as Parameters<typeof putRiskScoringWeights>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        is_default: false,
        organization_id: VALID_ORG_UUID
      })
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "risk_scoring_weights.updated",
        resourceType: "risk_scoring_weights",
        organizationId: VALID_ORG_UUID,
        payload: expect.objectContaining({
          entity_criticality_weights: validBody().entity_criticality_weights,
          obligation_priority_weights: validBody().obligation_priority_weights,
          severity_weights: validBody().severity_weights
        })
      })
    );
  });

  it("invalid body returns 400 without hitting pg or audit", async () => {
    const req = {
      body: { entity_criticality_weights: { critical: 1.0 } }, // missing keys
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof putRiskScoringWeights>[0];
    const res = makeRes();

    await putRiskScoringWeights(
      req,
      res as unknown as Parameters<typeof putRiskScoringWeights>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("missing org context returns 403", async () => {
    const req = {
      body: validBody(),
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof putRiskScoringWeights>[0];
    const res = makeRes();

    await putRiskScoringWeights(
      req,
      res as unknown as Parameters<typeof putRiskScoringWeights>[1]
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
