import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be hoisted above the SUT import. vitest hoists vi.mock to the
// top of the module, but the mock factories below must capture symbols
// declared via vi.hoisted so they're initialized before the SUT runs.
const { mockClientQuery, mockClientRelease, mockPgQuery } = vi.hoisted(() => ({
  mockClientQuery: vi.fn(),
  mockClientRelease: vi.fn(),
  mockPgQuery: vi.fn()
}));

vi.mock("../infra/postgres.js", () => {
  const handle = {
    query: mockPgQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease
    })
  };
  // The service now runs elevated (pgElevated); keep pg pointed at the same
  // spies so transitive importers and assertions are unaffected.
  return { pg: handle, pgElevated: handle };
});

// posture snapshot is heavy and side-effecty; we test it at the
// processSignal-orchestration level only (was-it-called?). The actual
// snapshot computation is exercised by other tests / live runs.
vi.mock("../lib/postureComputation.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "../lib/postureComputation.js"
  );
  return {
    ...actual,
    computePosture: vi.fn().mockReturnValue({
      overall_score: 50,
      overall_severity: "Moderate",
      open_finding_count: 0,
      open_action_count: 0,
      overdue_action_count: 0,
      computation_rationale: {},
      domain_scores: []
    }),
    severityToPriority: vi.fn().mockReturnValue("near_term"),
    FALLBACK_CONTEXT: { regulated: false, handlesPII: false, safetyCritical: false, scale: "Small" }
  };
});

vi.mock("../lib/workflowScoringIntegration.js", () => ({
  buildWorkflowSignalBreakdown: vi.fn().mockReturnValue({}),
  buildScoringRationaleExtension: vi.fn().mockReturnValue({})
}));

import {
  runMatcherForSignal,
  processSignal,
  type CyberSignalRecord
} from "../lib/cyberSignalProcessingService.js";
import { DEFAULT_WEIGHTS } from "../lib/riskScoring.js";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const SIGNAL_ID = "33333333-3333-4333-8333-333333333333";
const VENDOR_ID = "44444444-4444-4444-8444-444444444444";
const AI_SYSTEM_ID = "55555555-5555-4555-8555-555555555555";
const FINDING_ID = "66666666-6666-4666-8666-666666666666";
const SUGGESTION_ID = "77777777-7777-4777-8777-777777777777";

function makeSignal(overrides: Partial<CyberSignalRecord> = {}): CyberSignalRecord {
  return {
    id: SIGNAL_ID,
    organization_id: ORG_A,
    source: "nvd",
    signal_type: "cve",
    severity: "High",
    normalized_summary: "Test signal",
    affected_vendor: "Microsoft",
    affected_cve: "CVE-2026-0001",
    ...overrides
  };
}

function vendorRow(criticality: string | null = "high") {
  return { id: VENDOR_ID, name: "Microsoft", criticality };
}

function aiSystemRow(criticality: string | null = "medium") {
  return { id: AI_SYSTEM_ID, name: "Claude API", criticality };
}

function weightsRow() {
  return {
    entity_criticality_weights: DEFAULT_WEIGHTS.entity_criticality_weights,
    obligation_priority_weights: DEFAULT_WEIGHTS.obligation_priority_weights,
    severity_weights: DEFAULT_WEIGHTS.severity_weights
  };
}

function findingRow() {
  return { id: FINDING_ID, organization_id: ORG_A, source_type: "cyber_signal", source_id: SIGNAL_ID };
}

function suggestionInsertReturn() {
  return { id: SUGGESTION_ID };
}

beforeEach(() => {
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockPgQuery.mockReset();
});

// =====================================================================
// runMatcherForSignal — vendor match path
// =====================================================================

describe("runMatcherForSignal — vendor match", () => {
  it("happy path: vendor matches → finding INSERT + suggestion INSERT, returns score from computeRiskScore", async () => {
    // Standalone call (no external client) — owns the BEGIN/COMMIT.
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings INSERT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // weights SELECT (defaults)
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion INSERT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                         // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    expect(result.matched_vendor_id).toBe(VENDOR_ID);
    expect(result.matched_ai_system_id).toBeNull();
    expect(result.matched_branch).toBe("vendor_name_ilike");
    expect(result.suggestion_id).toBe(SUGGESTION_ID);
    // High severity (0.75) × high vendor criticality (0.75) × 1.0 (vendor) × 100 = 56.25 → 56
    expect(result.match_score).toBe(56);
    expect(result.finding).toEqual(findingRow());
    expect(result.domain).toBe("Vendor Risk");

    // Verify the suggestion INSERT included match_metadata with the right shape.
    const suggestionInsertCall = mockClientQuery.mock.calls[4]!;
    const suggestionParams = suggestionInsertCall[1] as unknown[];
    const matchMetadataParam = suggestionParams[6] as string;
    const parsedMetadata = JSON.parse(matchMetadataParam);
    expect(parsedMetadata).toEqual({
      source: "nvd",
      matched_branch: "vendor_name_ilike",
      matched_string: "Microsoft"
    });
    // match_score parameter is the integer 56, not a string.
    expect(suggestionParams[5]).toBe(56);

    // BEGIN + 4 work queries + COMMIT = 6 client.query calls.
    expect(mockClientQuery).toHaveBeenCalledTimes(6);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("uses external client when provided — does NOT issue its own BEGIN/COMMIT/release", async () => {
    const externalClient = {
      query: vi.fn(),
      release: vi.fn()
    };
    externalClient.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })       // vendor SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })            // findings INSERT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                        // weights SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] }); // suggestion INSERT

    const result = await runMatcherForSignal(
      makeSignal(),
      ORG_A,
      externalClient as unknown as Parameters<typeof runMatcherForSignal>[2]
    );

    expect(result.suggestion_id).toBe(SUGGESTION_ID);
    // No BEGIN/COMMIT issued by the function — the caller owns the tx.
    const calls = externalClient.query.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("BEGIN");
    expect(calls).not.toContain("COMMIT");
    expect(externalClient.release).not.toHaveBeenCalled();
    // Default pg.connect path was NOT used either.
    expect(mockClientRelease).not.toHaveBeenCalled();
  });

  it("idempotent: ON CONFLICT skip → suggestion_id null and match_score null", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                    // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })   // vendor SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })        // findings INSERT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                    // weights SELECT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                    // suggestion INSERT — ON CONFLICT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                   // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    expect(result.matched_branch).toBe("vendor_name_ilike");
    expect(result.matched_vendor_id).toBe(VENDOR_ID);
    // ON CONFLICT pending suggestion exists; matcher is a no-op on suggestion writes.
    expect(result.suggestion_id).toBeNull();
    expect(result.match_score).toBeNull();
    // Findings INSERT still ran (dual-write — pre-existing dup-finding bug
    // is a separate package's responsibility).
    expect(result.finding).toEqual(findingRow());
  });

  it("ON CONFLICT INSERT statement uses the partial-unique WHERE predicate", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // weights
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                         // COMMIT

    await runMatcherForSignal(makeSignal(), ORG_A);

    const sql = mockClientQuery.mock.calls[4]![0] as string;
    expect(sql).toMatch(
      /ON CONFLICT \(organization_id, signal_id, target_type, target_id\)/
    );
    expect(sql).toMatch(/WHERE accepted_at IS NULL AND dismissed_at IS NULL/);
    expect(sql).toMatch(/DO NOTHING/);
  });
});

// =====================================================================
// runMatcherForSignal — ai_system match path
// =====================================================================

describe("runMatcherForSignal — ai_system match", () => {
  it("ai_system matches when no vendor matches: writes both finding and suggestion with target_type='ai_system'", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // vendor: no match
      .mockResolvedValueOnce({ rowCount: 1, rows: [aiSystemRow("medium")] })     // ai_system SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings INSERT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // weights SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion INSERT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                         // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    expect(result.matched_branch).toBe("ai_system_name_ilike");
    expect(result.matched_vendor_id).toBeNull();
    expect(result.matched_ai_system_id).toBe(AI_SYSTEM_ID);
    expect(result.suggestion_id).toBe(SUGGESTION_ID);
    // High (0.75) × medium (0.5) × 1.0 (ai_system) × 100 = 37.5 → 38
    expect(result.match_score).toBe(38);
    expect(result.domain).toBe("AI Governance");

    // Suggestion INSERT params: target_type = 'ai_system', target_id = AI_SYSTEM_ID
    const params = mockClientQuery.mock.calls[5]![1] as unknown[];
    expect(params[2]).toBe("ai_system");
    expect(params[3]).toBe(AI_SYSTEM_ID);
  });
});

// =====================================================================
// runMatcherForSignal — no-match path
// =====================================================================

describe("runMatcherForSignal — no match", () => {
  it("no vendor and no ai_system match: no finding, no suggestion, branch='no_match'", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })  // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })  // vendor: no match
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })  // ai_system: no match
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    expect(result.matched_branch).toBe("no_match");
    expect(result.matched_vendor_id).toBeNull();
    expect(result.matched_ai_system_id).toBeNull();
    expect(result.finding).toBeNull();
    expect(result.suggestion_id).toBeNull();
    expect(result.match_score).toBeNull();
    // Skips findings INSERT, weights SELECT, suggestion INSERT entirely.
    // 4 calls total: BEGIN, vendor, ai_system, COMMIT.
    expect(mockClientQuery).toHaveBeenCalledTimes(4);
  });

  it("affected_vendor null short-circuits matching entirely", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })  // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // COMMIT

    const result = await runMatcherForSignal(
      makeSignal({ affected_vendor: null }),
      ORG_A
    );

    expect(result.matched_branch).toBe("no_match");
    expect(result.finding).toBeNull();
    expect(result.suggestion_id).toBeNull();
    // BEGIN + COMMIT only — neither vendor nor ai_system query ran.
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
  });
});

// =====================================================================
// runMatcherForSignal — cross-org isolation
// =====================================================================

describe("runMatcherForSignal — cross-org isolation", () => {
  it("vendor query is parameterized by orgId — passing a different org returns no match against ORG_A's inventory", async () => {
    // The vendor SELECT receives ORG_B as $1. Our mock returns 0 rows
    // because the SELECT predicate (organization_id = $1) won't match a
    // vendor row scoped to ORG_A. We assert the SQL includes the
    // organization_id filter so the function CANNOT leak across orgs.
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })  // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })  // vendor: no rows for ORG_B
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })  // ai_system: no rows
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // COMMIT

    await runMatcherForSignal(makeSignal({ organization_id: ORG_A }), ORG_B);

    const vendorSql = mockClientQuery.mock.calls[1]![0] as string;
    const vendorParams = mockClientQuery.mock.calls[1]![1] as unknown[];
    expect(vendorSql).toMatch(/WHERE organization_id = \$1/);
    expect(vendorParams[0]).toBe(ORG_B);

    const aiSql = mockClientQuery.mock.calls[2]![0] as string;
    const aiParams = mockClientQuery.mock.calls[2]![1] as unknown[];
    expect(aiSql).toMatch(/WHERE organization_id = \$1/);
    expect(aiParams[0]).toBe(ORG_B);
  });
});

// =====================================================================
// runMatcherForSignal — KEV override end-to-end
// =====================================================================

describe("runMatcherForSignal — KEV override", () => {
  it("source='cisa-kev' + severity='Low' produces score=100 for critical vendor", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("critical")] })     // vendor: critical
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings INSERT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // weights: defaults
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion INSERT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                         // COMMIT

    const result = await runMatcherForSignal(
      makeSignal({ severity: "Low", source: "cisa-kev" }),
      ORG_A
    );

    // KEV override → severity_w = 1.0; critical vendor → entity_w = 1.0;
    // vendor → obligation_w = 1.0; product = 100.
    expect(result.match_score).toBe(100);

    // match_metadata records the canonical KEV source string.
    const params = mockClientQuery.mock.calls[4]![1] as unknown[];
    const metadata = JSON.parse(params[6] as string);
    expect(metadata.source).toBe("cisa-kev");
  });
});

// =====================================================================
// runMatcherForSignal — defaults fallback
// =====================================================================

describe("runMatcherForSignal — weights fallback", () => {
  it("org with no risk_scoring_weights row uses DEFAULT_WEIGHTS, score is sensible", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // weights: NONE
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                         // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    // Default weights produce 56 for High + high vendor + vendor type.
    expect(result.match_score).toBe(56);
  });

  it("org with configured weights uses those values", async () => {
    // Custom weights row that flattens severity-high to 1.0.
    const customWeights = {
      entity_criticality_weights: DEFAULT_WEIGHTS.entity_criticality_weights,
      obligation_priority_weights: DEFAULT_WEIGHTS.obligation_priority_weights,
      severity_weights: { Critical: 1.0, High: 1.0, Moderate: 0.5, Low: 0.25 }
    };
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings
      .mockResolvedValueOnce({ rowCount: 1, rows: [customWeights] })             // weights: configured
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                         // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    // High (now 1.0) × high (0.75) × 1.0 × 100 = 75
    expect(result.match_score).toBe(75);
  });
});

// =====================================================================
// runMatcherForSignal — error propagation
// =====================================================================

describe("runMatcherForSignal — error propagation", () => {
  it("when standalone, ROLLBACKs on inner error and propagates", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] }) // vendor
      .mockRejectedValueOnce(new Error("simulated findings INSERT fail")) // findings INSERT throws
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                  // ROLLBACK

    await expect(runMatcherForSignal(makeSignal(), ORG_A)).rejects.toThrow(
      /simulated findings INSERT fail/
    );

    const calls = mockClientQuery.mock.calls.map((c) => c[0]);
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("when given external client, does NOT ROLLBACK — caller owns the tx", async () => {
    const externalClient = {
      query: vi.fn(),
      release: vi.fn()
    };
    externalClient.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })
      .mockRejectedValueOnce(new Error("findings INSERT fail with external client"));

    await expect(
      runMatcherForSignal(
        makeSignal(),
        ORG_A,
        externalClient as unknown as Parameters<typeof runMatcherForSignal>[2]
      )
    ).rejects.toThrow(/findings INSERT fail with external client/);

    const calls = externalClient.query.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("ROLLBACK");
    expect(calls).not.toContain("BEGIN");
    expect(externalClient.release).not.toHaveBeenCalled();
  });
});

// =====================================================================
// processSignal — orchestration over runMatcherForSignal + phases 4-5
// =====================================================================

describe("processSignal — org-scoped signal", () => {
  it("calls runMatcherForSignal AND runs phases 4-5 (linked_finding_id, risk exposure)", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // weights
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // phase 4: signal UPDATE
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                          // phase 5: risks UPDATE
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                         // COMMIT

    // Phase 6: org profile + 4 parallel selects + posture writes (mocked).
    mockPgQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    const result = await processSignal(makeSignal({ organization_id: ORG_A }));

    expect(result.matched_vendor_id).toBe(VENDOR_ID);
    expect(result.finding).toEqual(findingRow());

    // Phase 4: cyber_signals UPDATE was issued with the finding id.
    const phase4Sql = mockClientQuery.mock.calls[5]![0] as string;
    expect(phase4Sql).toMatch(/UPDATE cyber_signals/);
    expect(phase4Sql).toMatch(/SET processed\s+= TRUE/);
    expect(phase4Sql).toMatch(/linked_finding_id = \$1/);
    const phase4Params = mockClientQuery.mock.calls[5]![1] as unknown[];
    expect(phase4Params[0]).toBe(FINDING_ID);
  });
});

describe("processSignal — global signal short-circuit", () => {
  it("source signal with org_id IS NULL: short-circuits before phase 4 entirely", async () => {
    // No client.query calls expected — processSignal returns immediately
    // before opening a connection.
    const result = await processSignal(
      // CyberSignalRecord types organization_id as string, but we test
      // the runtime null handling because that's the actual invariant.
      makeSignal({ organization_id: null as unknown as string })
    );

    expect(result.finding).toBeNull();
    expect(result.matched_vendor_id).toBeNull();
    expect(result.matched_ai_system_id).toBeNull();
    expect(result.risks_flagged).toBe(0);
    expect(result.posture_recalculated).toBe(false);

    // No DB work whatsoever.
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(mockPgQuery).not.toHaveBeenCalled();
    expect(mockClientRelease).not.toHaveBeenCalled();
  });

  it("never writes linked_finding_id when source signal has org_id IS NULL", async () => {
    // Belt-and-suspenders: invariant is row-based, not caller-based.
    // If a future caller passes through processSignal with a null-org
    // row, the linked_finding_id write must still be skipped.
    await processSignal(
      makeSignal({ organization_id: null as unknown as string })
    );

    const allSqls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    const linkedFindingWrites = allSqls.filter((s) =>
      /UPDATE cyber_signals[\s\S]*linked_finding_id/.test(s)
    );
    expect(linkedFindingWrites).toEqual([]);
  });
});

// =====================================================================
// Dual-write invariant — both findings AND suggestions written
// =====================================================================

describe("dual-write invariant", () => {
  it("vendor match via runMatcherForSignal writes BOTH findings and suggestions", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await runMatcherForSignal(makeSignal(), ORG_A);

    const sqls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    const findingsInsert = sqls.find((s) => /INSERT INTO findings/.test(s));
    const suggestionInsert = sqls.find((s) =>
      /INSERT INTO signal_match_suggestions/.test(s)
    );

    expect(findingsInsert).toBeDefined();
    expect(suggestionInsert).toBeDefined();
  });
});
