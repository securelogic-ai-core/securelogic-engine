import { describe, it, expect, vi, beforeEach } from "vitest";

// pg mock — pg.connect returns a client whose query is the spy.
//
// Since A04-G1 gap C' (PR-C1), loadTemplate runs inside withTenant() and gets
// its client from createSavepointClient(requireTenantContext()) rather than
// pg.connect(). The mocks below make those tenant primitives pass-throughs that
// still route .query() to mockClientQuery, so the existing BEGIN/INSERT/COMMIT
// query-tape and assertions are unchanged:
//   - withTenant(orgId, fn) => fn()            (no real transaction)
//   - requireTenantContext() => synthetic ctx  (carries the mock client)
//   - createSavepointClient(ctx) => ctx.client (the mockClientQuery client)
// pg.connect is retained for backward-compat but is no longer exercised.
const { mockClientQuery, mockClientRelease } = vi.hoisted(() => ({
  mockClientQuery: vi.fn(),
  mockClientRelease: vi.fn(),
}));
const { mockSavepointClient, mockWithTenant } = vi.hoisted(() => ({
  mockSavepointClient: {
    query: mockClientQuery,
    release: mockClientRelease,
  },
  mockWithTenant: vi.fn(
    async (_orgId: string, fn: () => Promise<unknown>) => fn()
  ),
}));
vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    }),
  },
  withTenant: mockWithTenant,
  requireTenantContext: vi.fn(() => ({
    client: mockSavepointClient,
    orgId: "test-org",
    savepoint: { n: 0 },
  })),
}));
vi.mock("../infra/tenantContext.js", () => ({
  createSavepointClient: vi.fn(() => mockSavepointClient),
}));

const { mockWriteAuditEvent } = vi.hoisted(() => ({
  mockWriteAuditEvent: vi.fn(),
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: mockWriteAuditEvent,
}));

import {
  loadTemplate,
  industryTemplatesEnabled,
  isTemplateReviewBlocked,
  TemplateLoaderInputError,
} from "../lib/templateLoader.js";
import { ALL_INDUSTRIES, TEMPLATES } from "../../templates/index.js";

const ORG_UUID = "11111111-1111-4111-8111-111111111111";
const FRAMEWORK_UUID = "22222222-2222-4222-8222-222222222222";
const REQUIREMENT_UUID = "33333333-3333-4333-8333-333333333333";
const NEW_CONTROL_UUID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockWithTenant.mockClear();
  mockWriteAuditEvent.mockReset();
});

/**
 * Helper: build a query tape for a fully-fresh-org load (every INSERT
 * succeeds with rowCount 1) for the given template. The order matches
 * the loader's pass order: vendors → ai_systems → obligations →
 * frameworks (upsert) → requirements (synthetic) → controls + mappings.
 */
function buildHappyPathTape(industryId: keyof typeof TEMPLATES): void {
  const t = TEMPLATES[industryId];

  mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // BEGIN

  for (const _ of t.vendors) {
    mockClientQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "vendor-id" }],
    });
  }
  for (const _ of t.ai_systems) {
    mockClientQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "ai-id" }],
    });
  }
  for (const _ of t.obligations) {
    mockClientQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "obl-id" }],
    });
  }

  const distinctFrameworks = new Set(t.controls.map((c) => c.framework_ref));
  for (const _ of distinctFrameworks) {
    // framework upsert
    mockClientQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: FRAMEWORK_UUID }],
    });
    // synthetic requirement upsert
    mockClientQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: REQUIREMENT_UUID }],
    });
  }

  for (const _ of t.controls) {
    // control insert
    mockClientQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: NEW_CONTROL_UUID }],
    });
    // control_mappings insert
    mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
  }

  mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // COMMIT
}

// ====================================================================
// Per-template happy paths
// ====================================================================

describe("loadTemplate — per-industry happy path", () => {
  for (const industryId of ALL_INDUSTRIES) {
    it(`${industryId}: loads all rows, populates template_source, writes audit event`, async () => {
      const t = TEMPLATES[industryId];
      buildHappyPathTape(industryId);

      const result = await loadTemplate(ORG_UUID, industryId);

      expect(result.industry_id).toBe(industryId);
      expect(result.selected_count).toBe(
        t.vendors.length +
          t.ai_systems.length +
          t.obligations.length +
          t.controls.length
      );
      expect(result.inserted.vendors).toBe(t.vendors.length);
      expect(result.inserted.ai_systems).toBe(t.ai_systems.length);
      expect(result.inserted.obligations).toBe(t.obligations.length);
      expect(result.inserted.controls).toBe(t.controls.length);
      expect(result.skipped).toEqual({
        vendors: 0,
        ai_systems: 0,
        obligations: 0,
        controls: 0,
      });

      // BEGIN + COMMIT bracket the transaction.
      const calls = mockClientQuery.mock.calls.map((c) => c[0]);
      expect(calls[0]).toBe("BEGIN");
      expect(calls[calls.length - 1]).toBe("COMMIT");
      // No ROLLBACK on a happy path.
      expect(calls.includes("ROLLBACK")).toBe(false);

      // Every vendor INSERT carried template_source = industryId in $6.
      const vendorInserts = mockClientQuery.mock.calls.filter((c) =>
        String(c[0]).startsWith("INSERT INTO vendors")
      );
      for (const call of vendorInserts) {
        const params = call[1] as unknown[];
        expect(params[5]).toBe(industryId);
      }

      // Audit event written exactly once with the template's industry id
      // in payload, resource_id NULL.
      expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
      const auditArg = mockWriteAuditEvent.mock.calls[0]![0] as {
        eventType: string;
        resourceType: string;
        resourceId: string | null;
        payload: { industry_id: string };
      };
      expect(auditArg.eventType).toBe("industry_template.loaded");
      expect(auditArg.resourceType).toBe("industry_template");
      expect(auditArg.resourceId).toBeNull();
      expect(auditArg.payload.industry_id).toBe(industryId);

      // The load runs inside a single tenant scope (savepoint client's
      // release() is a no-op owned by withTenant, so the loader no longer
      // calls client.release() directly — assert the scope was entered).
      expect(mockWithTenant).toHaveBeenCalledTimes(1);
      expect(mockWithTenant).toHaveBeenCalledWith(ORG_UUID, expect.any(Function));
    });
  }
});

// ====================================================================
// Vendor template_metadata flag handling
// ====================================================================

describe("loadTemplate — vendor template_metadata", () => {
  it("vendor with flags writes JSONB { flags: { ... } } in $7", async () => {
    buildHappyPathTape("healthcare-saas");

    await loadTemplate(ORG_UUID, "healthcare-saas");

    // Find the Epic vendor INSERT (first healthcare-specific entry).
    const vendorInserts = mockClientQuery.mock.calls.filter((c) =>
      String(c[0]).startsWith("INSERT INTO vendors")
    );
    const epicCall = vendorInserts.find(
      (c) => (c[1] as unknown[])[1] === "Epic"
    );
    expect(epicCall).toBeDefined();
    const flagsParam = (epicCall![1] as unknown[])[6];
    // Encoded as JSON string by the loader.
    expect(typeof flagsParam).toBe("string");
    const parsed = JSON.parse(flagsParam as string) as {
      flags: { processes_phi: boolean; baa_required: boolean };
    };
    expect(parsed.flags.processes_phi).toBe(true);
    expect(parsed.flags.baa_required).toBe(true);
  });

  it("vendor without flags writes NULL in template_metadata", async () => {
    buildHappyPathTape("healthcare-saas");
    await loadTemplate(ORG_UUID, "healthcare-saas");

    const vendorInserts = mockClientQuery.mock.calls.filter((c) =>
      String(c[0]).startsWith("INSERT INTO vendors")
    );
    // AWS has no flags object.
    const awsCall = vendorInserts.find(
      (c) => (c[1] as unknown[])[1] === "AWS"
    );
    expect(awsCall).toBeDefined();
    expect((awsCall![1] as unknown[])[6]).toBeNull();
  });
});

// ====================================================================
// Dedup on second load
// ====================================================================

describe("loadTemplate — dedup on second load", () => {
  it("second load with all rows already-existing reports inserted=0, skipped=N for each section", async () => {
    const t = TEMPLATES["healthcare-saas"];

    mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // BEGIN
    // Every vendor / ai_system / obligation INSERT returns rowCount=0
    // (ON CONFLICT DO NOTHING fired).
    for (const _ of t.vendors) {
      mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    }
    for (const _ of t.ai_systems) {
      mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    }
    for (const _ of t.obligations) {
      mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    }
    // Frameworks still upsert (the DO UPDATE returns 1 row).
    const distinctFrameworks = new Set(t.controls.map((c) => c.framework_ref));
    for (const _ of distinctFrameworks) {
      mockClientQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: FRAMEWORK_UUID }],
      });
      mockClientQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: REQUIREMENT_UUID }],
      });
    }
    // Controls all conflict — no control_mappings insert for any of them.
    for (const _ of t.controls) {
      mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    }
    mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // COMMIT

    const result = await loadTemplate(ORG_UUID, "healthcare-saas");

    expect(result.inserted).toEqual({
      vendors: 0,
      ai_systems: 0,
      obligations: 0,
      controls: 0,
    });
    expect(result.skipped.vendors).toBe(t.vendors.length);
    expect(result.skipped.obligations).toBe(t.obligations.length);
    expect(result.skipped.controls).toBe(t.controls.length);

    // Critically: NO control_mappings INSERTs were issued for the
    // skipped controls. Manually-created controls do not get
    // retro-tagged with the framework via the template's synthetic
    // requirement.
    const mappingInserts = mockClientQuery.mock.calls.filter((c) =>
      String(c[0]).startsWith("INSERT INTO control_mappings")
    );
    expect(mappingInserts.length).toBe(0);
  });
});

// ====================================================================
// Selective load via selectedItemIds
// ====================================================================

describe("loadTemplate — selective load", () => {
  it("loads only items whose id is in selectedItemIds", async () => {
    const t = TEMPLATES["b2b-ai"];
    // Pick one vendor, one obligation, one control.
    const vendorPick     = t.vendors[0]!;
    const obligationPick = t.obligations[0]!;
    const controlPick    = t.controls[0]!;
    const selected = new Set<string>([
      vendorPick.id,
      obligationPick.id,
      controlPick.id,
    ]);

    mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({                            // vendor
      rowCount: 1,
      rows: [{ id: "v" }],
    });
    mockClientQuery.mockResolvedValueOnce({                            // obligation
      rowCount: 1,
      rows: [{ id: "o" }],
    });
    // 1 framework needed for the single selected control.
    mockClientQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: FRAMEWORK_UUID }],
    });
    mockClientQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: REQUIREMENT_UUID }],
    });
    mockClientQuery.mockResolvedValueOnce({                            // control
      rowCount: 1,
      rows: [{ id: NEW_CONTROL_UUID }],
    });
    mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });  // mapping
    mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });  // COMMIT

    const result = await loadTemplate(ORG_UUID, "b2b-ai", {
      selectedItemIds: selected,
    });

    expect(result.selected_count).toBe(3);
    expect(result.inserted).toEqual({
      vendors: 1,
      ai_systems: 0,
      obligations: 1,
      controls: 1,
    });

    // Verify the NAME landed in the vendor INSERT was vendorPick.name —
    // confirms we filtered correctly, not "first three of every type".
    const vendorInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).startsWith("INSERT INTO vendors")
    );
    expect((vendorInsert![1] as unknown[])[1]).toBe(vendorPick.name);
  });

  it("empty selectedItemIds set loads nothing (selected_count=0)", async () => {
    mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // BEGIN
    // No INSERTs happen because filtering produces empty arrays in all
    // four sections, including no distinct frameworks.
    mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // COMMIT

    const result = await loadTemplate(ORG_UUID, "fintech", {
      selectedItemIds: new Set<string>(),
    });

    expect(result.selected_count).toBe(0);
    expect(result.inserted).toEqual({
      vendors: 0,
      ai_systems: 0,
      obligations: 0,
      controls: 0,
    });
    expect(result.skipped).toEqual({
      vendors: 0,
      ai_systems: 0,
      obligations: 0,
      controls: 0,
    });
  });
});

// ====================================================================
// Cross-org isolation
// ====================================================================

describe("loadTemplate — cross-org isolation", () => {
  it("every INSERT carries the caller's organization_id in $1", async () => {
    buildHappyPathTape("fintech");
    const callerOrg = "55555555-5555-4555-8555-555555555555";

    await loadTemplate(callerOrg, "fintech");

    const insertCalls = mockClientQuery.mock.calls.filter((c) =>
      String(c[0]).startsWith("INSERT INTO ")
    );
    for (const call of insertCalls) {
      const params = call[1] as unknown[];
      // Every INSERT has organization_id as $1 EXCEPT control_mappings
      // and the synthetic requirements row (no direct org_id column,
      // tenant scope flows through framework_id).
      const sql = String(call[0]);
      if (sql.startsWith("INSERT INTO control_mappings")) continue;
      if (sql.startsWith("INSERT INTO requirements")) continue;
      expect(params[0]).toBe(callerOrg);
    }
  });
});

// ====================================================================
// Framework synthetic-requirement linkage
// ====================================================================

describe("loadTemplate — synthetic requirement + control_mapping", () => {
  it("creates one synthetic requirement per distinct framework and links every newly-inserted control", async () => {
    const t = TEMPLATES["b2b-ai"];
    buildHappyPathTape("b2b-ai");

    await loadTemplate(ORG_UUID, "b2b-ai");

    const requirementInserts = mockClientQuery.mock.calls.filter((c) =>
      String(c[0]).startsWith("INSERT INTO requirements")
    );
    const distinctFrameworks = new Set(t.controls.map((c) => c.framework_ref));
    expect(requirementInserts.length).toBe(distinctFrameworks.size);

    // Synthetic reference_id is `industry-template:{industryId}`.
    const refIds = requirementInserts.map((c) => (c[1] as unknown[])[1]);
    for (const refId of refIds) {
      expect(refId).toBe("industry-template:b2b-ai");
    }

    // Synthetic title uses the human-readable template name.
    const titles = requirementInserts.map((c) => (c[1] as unknown[])[2]);
    for (const title of titles) {
      expect(title).toBe("B2B AI Tooling template baseline");
    }

    // Every successfully-inserted control got a control_mapping.
    const mappingInserts = mockClientQuery.mock.calls.filter((c) =>
      String(c[0]).startsWith("INSERT INTO control_mappings")
    );
    expect(mappingInserts.length).toBe(t.controls.length);
  });
});

// ====================================================================
// Error handling
// ====================================================================

describe("loadTemplate — error handling", () => {
  it("unknown industry id throws TemplateLoaderInputError without opening a tx", async () => {
    await expect(
      loadTemplate(ORG_UUID, "unknown" as unknown as "fintech")
    ).rejects.toBeInstanceOf(TemplateLoaderInputError);
    // No connect/query because validation fired first.
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("a vendor INSERT failure rolls back and re-throws; no audit event written", async () => {
    mockClientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // BEGIN
    mockClientQuery.mockRejectedValueOnce(new Error("disk full"));    // first vendor

    await expect(
      loadTemplate(ORG_UUID, "healthcare-saas")
    ).rejects.toThrow("disk full");

    // ROLLBACK was issued.
    const rollbackCalls = mockClientQuery.mock.calls.filter(
      (c) => c[0] === "ROLLBACK"
    );
    expect(rollbackCalls.length).toBe(1);
    // Audit event NOT written on rollback.
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    // The load ran inside a tenant scope (withTenant owns client release;
    // the loader no longer calls client.release() directly).
    expect(mockWithTenant).toHaveBeenCalledTimes(1);
  });
});

// ====================================================================
// Gate helpers
// ====================================================================

describe("industryTemplatesEnabled", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env["SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED"];
    delete process.env["NODE_ENV"];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function afterAll(fn: () => void): void {
    // Vitest's afterAll lives on the suite; use it via the test runner.
    // This stub keeps the typescript happy for the env restoration block.
    fn();
  }

  it("returns true when env var explicitly enabled, regardless of NODE_ENV", () => {
    process.env["SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED"] = "true";
    process.env["NODE_ENV"] = "production";
    expect(industryTemplatesEnabled()).toBe(true);
  });

  it("returns true in non-production runtime (development, test, etc.)", () => {
    process.env["NODE_ENV"] = "development";
    expect(industryTemplatesEnabled()).toBe(true);
  });

  it("returns false in production with the env var unset", () => {
    process.env["NODE_ENV"] = "production";
    expect(industryTemplatesEnabled()).toBe(false);
  });

  it("returns false in production with env var set to anything other than 'true'", () => {
    process.env["NODE_ENV"] = "production";
    process.env["SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED"] = "1";
    expect(industryTemplatesEnabled()).toBe(false);
  });
});

describe("isTemplateReviewBlocked", () => {
  it("all three v1 templates are review-blocked (each has at least one needs_review entry)", () => {
    expect(isTemplateReviewBlocked("healthcare-saas")).toBe(true);
    expect(isTemplateReviewBlocked("fintech")).toBe(true);
    expect(isTemplateReviewBlocked("b2b-ai")).toBe(true);
  });
});
