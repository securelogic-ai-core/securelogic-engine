import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  validateAiSystemVendorDependencyCreate,
  isUuid,
  isDependencyRole,
  DEPENDENCY_ROLES
} from "../lib/aiSystemVendorDependencyValidation.js";

// Mocks for the behavioral test section at the bottom of this file.
// vitest hoists vi.mock to the top of the module, so these take effect
// before the route file is imported below. Pure-validator and structural
// tests above this point do not import the route runtime and are unaffected.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() }
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn()
}));

const VALID_AI_SYSTEM_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_VENDOR_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const VALID_ORG_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_DEP_UUID = "22222222-2222-4222-8222-222222222222";
const VALID_DEP_UUID_2 = "33333333-3333-4333-8333-333333333333";

// ====================================================================
// validateAiSystemVendorDependencyCreate — body shape
// ====================================================================

describe("validateAiSystemVendorDependencyCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateAiSystemVendorDependencyCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateAiSystemVendorDependencyCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateAiSystemVendorDependencyCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects undefined body", () => {
    const r = validateAiSystemVendorDependencyCreate(undefined);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ====================================================================
// validateAiSystemVendorDependencyCreate — ai_system_id
// ====================================================================

describe("validateAiSystemVendorDependencyCreate — ai_system_id", () => {
  it("rejects missing ai_system_id", () => {
    const r = validateAiSystemVendorDependencyCreate({
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "model_provider"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_required");
  });

  it("rejects empty ai_system_id", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: "   ",
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "model_provider"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_required");
  });

  it("rejects non-UUID ai_system_id", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: "not-a-uuid",
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "model_provider"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_must_be_uuid");
  });
});

// ====================================================================
// validateAiSystemVendorDependencyCreate — vendor_id
// ====================================================================

describe("validateAiSystemVendorDependencyCreate — vendor_id", () => {
  it("rejects missing vendor_id", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      dependency_role: "model_provider"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_required");
  });

  it("rejects non-UUID vendor_id", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      vendor_id: "not-a-uuid",
      dependency_role: "model_provider"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_must_be_uuid");
  });
});

// ====================================================================
// validateAiSystemVendorDependencyCreate — dependency_role
// ====================================================================

describe("validateAiSystemVendorDependencyCreate — dependency_role", () => {
  it("rejects missing dependency_role", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      vendor_id: VALID_VENDOR_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("dependency_role_required");
  });

  it("rejects empty dependency_role", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "   "
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("dependency_role_required");
  });

  it("rejects invalid dependency_role", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "everything_provider"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("dependency_role_invalid");
  });

  for (const role of DEPENDENCY_ROLES) {
    it(`accepts ${role}`, () => {
      const r = validateAiSystemVendorDependencyCreate({
        ai_system_id: VALID_AI_SYSTEM_UUID,
        vendor_id: VALID_VENDOR_UUID,
        dependency_role: role
      });
      expect("input" in r).toBe(true);
      if ("input" in r) expect(r.input.dependency_role).toBe(role);
    });
  }
});

// ====================================================================
// validateAiSystemVendorDependencyCreate — notes
// ====================================================================

describe("validateAiSystemVendorDependencyCreate — notes", () => {
  it("defaults notes to null when omitted", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "runtime"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts and trims a short notes value", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "model_provider",
      notes: "  primary GPT-4 calls go through this  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r)
      expect(r.input.notes).toBe("primary GPT-4 calls go through this");
  });

  it("normalizes whitespace-only notes to null", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "runtime",
      notes: "   "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("rejects non-string notes", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "runtime",
      notes: 123
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string");
  });

  it("rejects notes longer than 500 chars", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "runtime",
      notes: "a".repeat(501)
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_too_long");
  });
});

// ====================================================================
// validateAiSystemVendorDependencyCreate — happy path
// ====================================================================

describe("validateAiSystemVendorDependencyCreate — happy path", () => {
  it("returns trimmed ids and role", () => {
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: `  ${VALID_AI_SYSTEM_UUID}  `,
      vendor_id: `  ${VALID_VENDOR_UUID}  `,
      dependency_role: "model_provider",
      notes: "context"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.ai_system_id).toBe(VALID_AI_SYSTEM_UUID);
      expect(r.input.vendor_id).toBe(VALID_VENDOR_UUID);
      expect(r.input.dependency_role).toBe("model_provider");
      expect(r.input.notes).toBe("context");
    }
  });

  it("ignores any organization_id value supplied in the body", () => {
    // The validator MUST NOT echo organization_id through. organization_id is
    // sourced exclusively from req.organizationContext at the route layer.
    const r = validateAiSystemVendorDependencyCreate({
      ai_system_id: VALID_AI_SYSTEM_UUID,
      vendor_id: VALID_VENDOR_UUID,
      dependency_role: "runtime",
      organization_id: "00000000-0000-0000-0000-000000000000"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(Object.keys(r.input).sort()).toEqual(
        ["ai_system_id", "dependency_role", "notes", "vendor_id"].sort()
      );
    }
  });
});

// ====================================================================
// isUuid + isDependencyRole + DEPENDENCY_ROLES
// ====================================================================

describe("isUuid", () => {
  it("accepts a v4-shaped UUID", () => {
    expect(isUuid(VALID_AI_SYSTEM_UUID)).toBe(true);
  });
  it("rejects empty", () => {
    expect(isUuid("")).toBe(false);
  });
  it("rejects malformed", () => {
    expect(isUuid("a1b2c3d4-e5f6-7890-abcd")).toBe(false);
  });
  it("rejects non-string", () => {
    expect(isUuid(42)).toBe(false);
  });
});

describe("isDependencyRole", () => {
  for (const r of DEPENDENCY_ROLES) {
    it(`accepts ${r}`, () => {
      expect(isDependencyRole(r)).toBe(true);
    });
  }
  it("rejects unknown role", () => {
    expect(isDependencyRole("storage")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isDependencyRole("")).toBe(false);
  });
  it("rejects non-string", () => {
    expect(isDependencyRole(null)).toBe(false);
  });
});

describe("DEPENDENCY_ROLES enum", () => {
  it("contains exactly the nine canonical roles", () => {
    expect([...DEPENDENCY_ROLES].sort()).toEqual(
      [
        "data_source",
        "feature_store",
        "mlops_platform",
        "model_provider",
        "observability",
        "other",
        "registry",
        "runtime",
        "training_data"
      ].sort()
    );
  });
});

// ====================================================================
// Structural source guard for the route file.
// Mirrors the link-route pattern.
// ====================================================================

const ROUTE_FILE = resolve(__dirname, "../routes/aiSystemVendorDependencies.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("aiSystemVendorDependencies route — tenant isolation invariants", () => {
  it("imports requireApiKey middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*requireApiKey/);
  });

  it("imports attachOrganizationContext middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*attachOrganizationContext/);
  });

  it("imports requireEntitlement middleware and gates on premium", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*requireEntitlement/);
    expect(ROUTE_SOURCE).toMatch(/requireEntitlement\(["']premium["']\)/);
  });

  it("references organization_id in SQL", () => {
    expect(ROUTE_SOURCE).toMatch(/organization_id/);
  });

  it("never reads organization_id from req.body", () => {
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\.organization_id/);
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\?\.organization_id/);
  });

  it("sources organizationId from req.organizationContext", () => {
    expect(ROUTE_SOURCE).toMatch(/organizationContext/);
  });

  it("returns 403 organization_context_missing when org context is absent", () => {
    expect(ROUTE_SOURCE).toMatch(/organization_context_missing/);
  });

  it("audit-logs via writeAuditEvent for create and delete", () => {
    expect(ROUTE_SOURCE).toMatch(/writeAuditEvent/);
    expect(ROUTE_SOURCE).toMatch(/ai_system_vendor_dependency\.created/);
    expect(ROUTE_SOURCE).toMatch(/ai_system_vendor_dependency\.deleted/);
  });

  it("uses soft delete (deleted_at IS NULL) for live-row queries", () => {
    expect(ROUTE_SOURCE).toMatch(/deleted_at IS NULL/);
    expect(ROUTE_SOURCE).toMatch(/SET deleted_at = NOW\(\)/);
  });

  it("performs same-org pre-flight on ai_system and vendor", () => {
    expect(ROUTE_SOURCE).toMatch(
      /FROM ai_systems WHERE id = \$1 AND organization_id = \$2/
    );
    expect(ROUTE_SOURCE).toMatch(
      /FROM vendors WHERE id = \$1 AND organization_id = \$2/
    );
  });

  it("declares all four required endpoints", () => {
    expect(ROUTE_SOURCE).toMatch(
      /router\.post\(\s*["']\/ai-system-vendor-dependencies["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.delete\(\s*["']\/ai-system-vendor-dependencies\/:id["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/ai-systems\/:id\/vendors["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/vendors\/:id\/ai-systems["']/
    );
  });

  it("scopes DELETE to organization_id (no IDOR)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /UPDATE ai_system_vendor_dependencies[\s\S]*WHERE id = \$1[\s\S]*AND organization_id = \$2/
    );
  });

  it("returns 404 (not 403) on cross-org access — no enumeration", () => {
    expect(ROUTE_SOURCE).toMatch(/ai_system_not_found/);
    expect(ROUTE_SOURCE).toMatch(/vendor_not_found/);
    expect(ROUTE_SOURCE).toMatch(/ai_system_vendor_dependency_not_found/);
  });

  it("ON CONFLICT key includes dependency_role (same vendor in multiple roles allowed)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /ON CONFLICT \(organization_id, ai_system_id, vendor_id, dependency_role\)[\s\S]*WHERE deleted_at IS NULL[\s\S]*DO NOTHING/
    );
  });

  it("recreate path is a fresh INSERT, never an un-delete (no SET deleted_at = NULL anywhere)", () => {
    // Soft-delete-then-recreate must produce a new row id. If the route ever
    // started clearing deleted_at on an existing row to satisfy a duplicate
    // POST, the recreated 'row' would carry the deleted row's id, the
    // created_at would not advance, and audit-trail integrity would break.
    // Guard against that pattern at the source level.
    expect(ROUTE_SOURCE).not.toMatch(/SET\s+deleted_at\s*=\s*NULL/i);
    expect(ROUTE_SOURCE).not.toMatch(/deleted_at\s*=\s*NULL\b(?![^,)]*--)/);
  });

  it("both GET joins scope the joined table to organization_id (defense in depth)", () => {
    // The dependency row's organization_id is already enforced — but if a
    // vendor or ai_system row were ever inserted with a mismatched
    // organization_id (a data integrity violation), the join could leak it
    // cross-tenant. The joined table's org_id appears in WHERE on both GETs.
    expect(ROUTE_SOURCE).toMatch(/AND v\.organization_id = \$1/);
    expect(ROUTE_SOURCE).toMatch(/AND a\.organization_id = \$1/);
  });

  it("DELETE audit payload includes ai_system_id, vendor_id, AND dependency_role", () => {
    // Future audit queries must be able to answer "show me all
    // model_provider relationships deleted for this org" without joining
    // back to a soft-deleted dependency row.
    expect(ROUTE_SOURCE).toMatch(
      /eventType:\s*["']ai_system_vendor_dependency\.deleted["'][\s\S]*?payload:\s*\{[\s\S]*?ai_system_id[\s\S]*?vendor_id[\s\S]*?dependency_role[\s\S]*?\}/
    );
  });
});

// ====================================================================
// Migration shape guard
// ====================================================================

const MIGRATION_FILE = resolve(
  __dirname,
  "../../../db/migrations/20260505_ai_system_vendor_dependencies.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_FILE, "utf8");

describe("ai_system_vendor_dependencies migration", () => {
  it("creates the ai_system_vendor_dependencies table", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE TABLE IF NOT EXISTS ai_system_vendor_dependencies/
    );
  });

  it("organization_id is NOT NULL and references organizations(id)", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /organization_id\s+UUID\s+NOT NULL\s+REFERENCES organizations\(id\)/
    );
  });

  it("ai_system_id references ai_systems(id) ON DELETE CASCADE", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /ai_system_id\s+UUID\s+NOT NULL\s+REFERENCES ai_systems\(id\)\s+ON DELETE CASCADE/
    );
  });

  it("vendor_id references vendors(id) ON DELETE CASCADE", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /vendor_id\s+UUID\s+NOT NULL\s+REFERENCES vendors\(id\)\s+ON DELETE CASCADE/
    );
  });

  it("dependency_role is NOT NULL with a CHECK enumerating the nine roles", () => {
    expect(MIGRATION_SOURCE).toMatch(/dependency_role\s+TEXT\s+NOT NULL/);
    for (const role of DEPENDENCY_ROLES) {
      expect(MIGRATION_SOURCE).toContain(`'${role}'`);
    }
    expect(MIGRATION_SOURCE).toMatch(
      /CONSTRAINT ai_system_vendor_dependencies_role_chk/
    );
  });

  it("declares deleted_at for soft delete", () => {
    expect(MIGRATION_SOURCE).toMatch(/deleted_at\s+TIMESTAMPTZ\s+NULL/);
  });

  it("partial unique index includes dependency_role in the key", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_system_vendor_dependencies_unique_active[\s\S]*\(organization_id, ai_system_id, vendor_id, dependency_role\)[\s\S]*WHERE deleted_at IS NULL/
    );
  });

  it("creates the per-ai_system and per-vendor hot-read indexes", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /idx_ai_system_vendor_dependencies_org_ai_system/
    );
    expect(MIGRATION_SOURCE).toMatch(
      /idx_ai_system_vendor_dependencies_org_vendor/
    );
  });

  it("does not alter ai_systems or vendors", () => {
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE ai_systems/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE vendors/);
  });
});

// ====================================================================
// Behavioral tests — create + delete + list edge cases
//
// Mocks: pg.query, writeAuditEvent. Handlers are imported by name from
// the route file (which exports them for direct invocation).
// ====================================================================

import { pg } from "../infra/postgres.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  createAiSystemVendorDependency,
  deleteAiSystemVendorDependency,
  listVendorsForAiSystem,
  listAiSystemsForVendor
} from "../routes/aiSystemVendorDependencies.js";

const mockQuery = pg.query as unknown as ReturnType<typeof vi.fn>;
const mockWriteAudit = writeAuditEvent as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function depRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_DEP_UUID,
    organization_id: VALID_ORG_UUID,
    ai_system_id: VALID_AI_SYSTEM_UUID,
    vendor_id: VALID_VENDOR_UUID,
    dependency_role: "model_provider",
    notes: null,
    created_at: "2026-05-05T00:00:00.000Z",
    created_by_user_id: null,
    deleted_at: null,
    ...overrides
  };
}

// --------------------- create handler ---------------------

describe("aiSystemVendorDependencies — create handler", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("happy path: returns 201 created:true with new row", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })  // ai_system preflight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })  // vendor preflight
      .mockResolvedValueOnce({ rowCount: 1, rows: [depRow()] }); // INSERT success

    const req = {
      body: {
        ai_system_id: VALID_AI_SYSTEM_UUID,
        vendor_id: VALID_VENDOR_UUID,
        dependency_role: "model_provider"
      },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createAiSystemVendorDependency>[0];
    const res = makeRes();

    await createAiSystemVendorDependency(
      req,
      res as unknown as Parameters<typeof createAiSystemVendorDependency>[1]
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ dependency: depRow(), created: true })
    );
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("idempotent: ON CONFLICT path returns 200 created:false with existing row, notes ignored", async () => {
    const existing = depRow({ notes: "previously stored notes" });
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })       // ai_system preflight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })       // vendor preflight
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })         // INSERT conflict
      .mockResolvedValueOnce({ rowCount: 1, rows: [existing] }); // SELECT existing

    const req = {
      body: {
        ai_system_id: VALID_AI_SYSTEM_UUID,
        vendor_id: VALID_VENDOR_UUID,
        dependency_role: "model_provider",
        notes: "second-call notes that MUST NOT be applied"
      },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createAiSystemVendorDependency>[0];
    const res = makeRes();

    await createAiSystemVendorDependency(
      req,
      res as unknown as Parameters<typeof createAiSystemVendorDependency>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ dependency: existing, created: false })
    );
    // 4 queries: ai preflight, vendor preflight, INSERT (conflict), SELECT existing.
    expect(mockQuery).toHaveBeenCalledTimes(4);
    // No UPDATE was issued — existing-unchanged contract holds.
    const updateCalled = mockQuery.mock.calls.some(
      (c) => typeof c[0] === "string" && /UPDATE ai_system_vendor_dependencies/.test(c[0])
    );
    expect(updateCalled).toBe(false);
  });

  it("cross-tenant ai_system_id: returns 404 ai_system_not_found, no INSERT issued", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // ai_system preflight: 0 rows

    const req = {
      body: {
        ai_system_id: VALID_AI_SYSTEM_UUID,
        vendor_id: VALID_VENDOR_UUID,
        dependency_role: "runtime"
      },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createAiSystemVendorDependency>[0];
    const res = makeRes();

    await createAiSystemVendorDependency(
      req,
      res as unknown as Parameters<typeof createAiSystemVendorDependency>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "ai_system_not_found" })
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
    // No INSERT was attempted.
    const insertCalled = mockQuery.mock.calls.some(
      (c) => typeof c[0] === "string" && /INSERT INTO ai_system_vendor_dependencies/.test(c[0])
    );
    expect(insertCalled).toBe(false);
  });

  it("cross-tenant vendor_id: returns 404 vendor_not_found after ai_system preflight passes", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })  // ai_system preflight: ok
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });   // vendor preflight: 0 rows

    const req = {
      body: {
        ai_system_id: VALID_AI_SYSTEM_UUID,
        vendor_id: VALID_VENDOR_UUID,
        dependency_role: "runtime"
      },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createAiSystemVendorDependency>[0];
    const res = makeRes();

    await createAiSystemVendorDependency(
      req,
      res as unknown as Parameters<typeof createAiSystemVendorDependency>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "vendor_not_found" })
    );
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const insertCalled = mockQuery.mock.calls.some(
      (c) => typeof c[0] === "string" && /INSERT INTO ai_system_vendor_dependencies/.test(c[0])
    );
    expect(insertCalled).toBe(false);
  });

  it("same vendor in multiple roles for same AI system: each role POST succeeds independently", async () => {
    // First call: model_provider role — INSERT succeeds.
    const runtimeRow = depRow({ id: VALID_DEP_UUID, dependency_role: "model_provider" });
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })          // ai_system
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })          // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [runtimeRow] }); // INSERT model_provider

    const req1 = {
      body: {
        ai_system_id: VALID_AI_SYSTEM_UUID,
        vendor_id: VALID_VENDOR_UUID,
        dependency_role: "model_provider"
      },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createAiSystemVendorDependency>[0];
    const res1 = makeRes();
    await createAiSystemVendorDependency(
      req1,
      res1 as unknown as Parameters<typeof createAiSystemVendorDependency>[1]
    );
    expect(res1.status).toHaveBeenCalledWith(201);

    // Second call: same (org, ai_system, vendor) but role=data_source — INSERT
    // also succeeds because dependency_role is part of the partial unique key.
    mockQuery.mockReset();
    const dataSourceRow = depRow({ id: VALID_DEP_UUID_2, dependency_role: "data_source" });
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })             // ai_system
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })             // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [dataSourceRow] }); // INSERT data_source

    const req2 = {
      body: {
        ai_system_id: VALID_AI_SYSTEM_UUID,
        vendor_id: VALID_VENDOR_UUID,
        dependency_role: "data_source"
      },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createAiSystemVendorDependency>[0];
    const res2 = makeRes();
    await createAiSystemVendorDependency(
      req2,
      res2 as unknown as Parameters<typeof createAiSystemVendorDependency>[1]
    );
    expect(res2.status).toHaveBeenCalledWith(201);
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({
        dependency: expect.objectContaining({ dependency_role: "data_source" }),
        created: true
      })
    );
  });

  it("soft-delete + recreate: new POST returns 201 with a NEW id (not the deleted row's id)", async () => {
    // Partial unique index excludes deleted_at IS NOT NULL rows, so the
    // mocked INSERT succeeds on the same key after a prior soft-delete and
    // returns a newly generated id. If the route ever regressed to
    // un-deleting (UPDATE ... SET deleted_at = NULL), the recreated row
    // would carry the deleted row's id and the assertion below would fail.
    // VALID_DEP_UUID is the prior (now soft-deleted) row's id; the recreate
    // must return a different id.
    const PRIOR_DELETED_ID = VALID_DEP_UUID;
    const recreated = depRow({ id: VALID_DEP_UUID_2 });
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })           // ai_system
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })           // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [recreated] });   // INSERT (no conflict — prior row deleted_at set)

    const req = {
      body: {
        ai_system_id: VALID_AI_SYSTEM_UUID,
        vendor_id: VALID_VENDOR_UUID,
        dependency_role: "model_provider"
      },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createAiSystemVendorDependency>[0];
    const res = makeRes();

    await createAiSystemVendorDependency(
      req,
      res as unknown as Parameters<typeof createAiSystemVendorDependency>[1]
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        dependency: expect.objectContaining({ id: VALID_DEP_UUID_2 }),
        created: true
      })
    );
    // Explicit id-distinctness assertion: the recreated id MUST NOT equal
    // the deleted row's id.
    const responsePayload = res.json.mock.calls[0][0] as {
      dependency: { id: string };
    };
    expect(responsePayload.dependency.id).not.toBe(PRIOR_DELETED_ID);
    // Confirm no UPDATE was issued by the handler (recreate is a fresh
    // INSERT path; un-delete would require an UPDATE).
    const updateCalled = mockQuery.mock.calls.some(
      (c) =>
        typeof c[0] === "string" &&
        /UPDATE ai_system_vendor_dependencies/.test(c[0])
    );
    expect(updateCalled).toBe(false);
  });
});

// --------------------- delete handler ---------------------

describe("aiSystemVendorDependencies — delete handler", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWriteAudit.mockReset();
  });

  it("happy path: returns 200 with the soft-deleted row and emits audit event with full payload", async () => {
    const deleted = depRow({
      dependency_role: "model_provider",
      deleted_at: "2026-05-05T01:00:00.000Z"
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [deleted] });

    const req = {
      params: { id: VALID_DEP_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof deleteAiSystemVendorDependency>[0];
    const res = makeRes();

    await deleteAiSystemVendorDependency(
      req,
      res as unknown as Parameters<typeof deleteAiSystemVendorDependency>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        dependency: expect.objectContaining({ id: VALID_DEP_UUID })
      })
    );

    // Audit payload must carry ai_system_id, vendor_id, and dependency_role
    // so future audit queries like "all model_provider relationships
    // deleted for this org" can answer without joining back to a soft-
    // deleted dependency row.
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "ai_system_vendor_dependency.deleted",
        resourceType: "ai_system_vendor_dependency",
        resourceId: VALID_DEP_UUID,
        organizationId: VALID_ORG_UUID,
        payload: expect.objectContaining({
          ai_system_id: VALID_AI_SYSTEM_UUID,
          vendor_id: VALID_VENDOR_UUID,
          dependency_role: "model_provider"
        })
      })
    );
  });

  it("cross-tenant id: UPDATE returns 0, returns 404 — no enumeration", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = {
      params: { id: VALID_DEP_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof deleteAiSystemVendorDependency>[0];
    const res = makeRes();

    await deleteAiSystemVendorDependency(
      req,
      res as unknown as Parameters<typeof deleteAiSystemVendorDependency>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "ai_system_vendor_dependency_not_found" })
    );
  });

  it("already-deleted row: UPDATE WHERE deleted_at IS NULL returns 0, returns 404", async () => {
    // Same shape as cross-tenant — uniformly 404 to avoid leaking row state.
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = {
      params: { id: VALID_DEP_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof deleteAiSystemVendorDependency>[0];
    const res = makeRes();

    await deleteAiSystemVendorDependency(
      req,
      res as unknown as Parameters<typeof deleteAiSystemVendorDependency>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "ai_system_vendor_dependency_not_found" })
    );
  });

  it("non-uuid id: returns 400 without hitting pg", async () => {
    const req = {
      params: { id: "not-a-uuid" },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof deleteAiSystemVendorDependency>[0];
    const res = makeRes();

    await deleteAiSystemVendorDependency(
      req,
      res as unknown as Parameters<typeof deleteAiSystemVendorDependency>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "dependency_id_must_be_uuid" })
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// --------------------- list-vendors-for-ai-system ---------------------

describe("aiSystemVendorDependencies — GET /api/ai-systems/:id/vendors", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns 200 with active deps joined to vendor name and role", async () => {
    const joinedRow = {
      dependency_id: VALID_DEP_UUID,
      dependency_role: "model_provider",
      notes: null,
      created_at: "2026-05-05T00:00:00.000Z",
      created_by_user_id: null,
      vendor_id: VALID_VENDOR_UUID,
      vendor_name: "OpenAI",
      vendor_criticality: "high",
      vendor_status: "active"
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })            // ai_system preflight
      .mockResolvedValueOnce({ rowCount: 1, rows: [joinedRow] });    // SELECT join

    const req = {
      params: { id: VALID_AI_SYSTEM_UUID },
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listVendorsForAiSystem>[0];
    const res = makeRes();

    await listVendorsForAiSystem(
      req,
      res as unknown as Parameters<typeof listVendorsForAiSystem>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 1,
        aiSystemId: VALID_AI_SYSTEM_UUID,
        organizationId: VALID_ORG_UUID,
        dependencies: [joinedRow]
      })
    );
    // The SELECT must filter on deleted_at IS NULL.
    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/d\.deleted_at IS NULL/);
    expect(sql).toMatch(/v\.name/);
    expect(sql).toMatch(/d\.dependency_role/);
  });

  it("excludes deleted_at IS NOT NULL rows (verified via SQL shape)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })  // ai_system preflight
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });   // SELECT (no live rows)

    const req = {
      params: { id: VALID_AI_SYSTEM_UUID },
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listVendorsForAiSystem>[0];
    const res = makeRes();

    await listVendorsForAiSystem(
      req,
      res as unknown as Parameters<typeof listVendorsForAiSystem>[1]
    );

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/d\.deleted_at IS NULL/);
    // Sanity: no clause that would re-include deleted rows.
    expect(sql).not.toMatch(/deleted_at IS NOT NULL/);
  });

  it("cross-tenant ai_system_id: returns 404, no SELECT", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = {
      params: { id: VALID_AI_SYSTEM_UUID },
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listVendorsForAiSystem>[0];
    const res = makeRes();

    await listVendorsForAiSystem(
      req,
      res as unknown as Parameters<typeof listVendorsForAiSystem>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "ai_system_not_found" })
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("fractional limit returns 400 invalid_limit, no SQL", async () => {
    const req = {
      params: { id: VALID_AI_SYSTEM_UUID },
      query: { limit: "10.5" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listVendorsForAiSystem>[0];
    const res = makeRes();

    await listVendorsForAiSystem(
      req,
      res as unknown as Parameters<typeof listVendorsForAiSystem>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_limit" })
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// --------------------- list-ai-systems-for-vendor ---------------------

describe("aiSystemVendorDependencies — GET /api/vendors/:id/ai-systems", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns 200 with active deps joined to ai_system name and role", async () => {
    const joinedRow = {
      dependency_id: VALID_DEP_UUID,
      dependency_role: "model_provider",
      notes: null,
      created_at: "2026-05-05T00:00:00.000Z",
      created_by_user_id: null,
      ai_system_id: VALID_AI_SYSTEM_UUID,
      ai_system_name: "OpenAI GPT-4 Integration",
      ai_system_criticality: "medium",
      ai_system_deployment_status: "production"
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })            // vendor preflight
      .mockResolvedValueOnce({ rowCount: 1, rows: [joinedRow] });    // SELECT join

    const req = {
      params: { id: VALID_VENDOR_UUID },
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listAiSystemsForVendor>[0];
    const res = makeRes();

    await listAiSystemsForVendor(
      req,
      res as unknown as Parameters<typeof listAiSystemsForVendor>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 1,
        vendorId: VALID_VENDOR_UUID,
        organizationId: VALID_ORG_UUID,
        dependencies: [joinedRow]
      })
    );
    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/d\.deleted_at IS NULL/);
    expect(sql).toMatch(/a\.name/);
    expect(sql).toMatch(/d\.dependency_role/);
  });

  it("excludes deleted_at IS NOT NULL rows (verified via SQL shape)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })  // vendor preflight
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });   // SELECT (no live rows)

    const req = {
      params: { id: VALID_VENDOR_UUID },
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listAiSystemsForVendor>[0];
    const res = makeRes();

    await listAiSystemsForVendor(
      req,
      res as unknown as Parameters<typeof listAiSystemsForVendor>[1]
    );

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/d\.deleted_at IS NULL/);
    expect(sql).not.toMatch(/deleted_at IS NOT NULL/);
  });

  it("cross-tenant vendor_id: returns 404, no SELECT", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = {
      params: { id: VALID_VENDOR_UUID },
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listAiSystemsForVendor>[0];
    const res = makeRes();

    await listAiSystemsForVendor(
      req,
      res as unknown as Parameters<typeof listAiSystemsForVendor>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "vendor_not_found" })
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("non-numeric limit returns 400 invalid_limit, no SQL", async () => {
    const req = {
      params: { id: VALID_VENDOR_UUID },
      query: { limit: "abc" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listAiSystemsForVendor>[0];
    const res = makeRes();

    await listAiSystemsForVendor(
      req,
      res as unknown as Parameters<typeof listAiSystemsForVendor>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_limit" })
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
