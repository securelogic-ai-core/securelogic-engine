import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

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

// GAP-1: every default-fixture signal uses signal_type 'cve', which now ALSO
// fires the control branch. Tests that exercise the vendor/AI path therefore
// see one extra `SELECT … FROM controls` query before COMMIT. Returning an
// empty control set keeps those tests focused on the vendor/AI path: empty →
// zero candidates → zero suggestion INSERTs. The control/obligation branches
// have their own dedicated coverage further down.
const EMPTY = { rowCount: 0, rows: [] };

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
      .mockResolvedValueOnce(EMPTY)                                              // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings INSERT
      .mockResolvedValueOnce(EMPTY)                                              // weights SELECT (defaults)
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion INSERT
      .mockResolvedValueOnce(EMPTY)                                              // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    expect(result.matched_vendor_id).toBe(VENDOR_ID);
    expect(result.matched_ai_system_id).toBeNull();
    expect(result.matched_branch).toBe("vendor_name_ilike");
    expect(result.suggestion_id).toBe(SUGGESTION_ID);
    // High severity (0.75) × high vendor criticality (0.75) × 1.0 (vendor) × 100 = 56.25 → 56
    expect(result.match_score).toBe(56);
    expect(result.finding).toEqual(findingRow());
    expect(result.domain).toBe("Vendor Risk");
    // GAP-1 accumulators default to empty for a vendor-only signal with no controls.
    expect(result.control_suggestion_ids).toEqual([]);
    expect(result.obligation_suggestion_ids).toEqual([]);

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

    // BEGIN + 4 work queries + control SELECT + COMMIT = 7 client.query calls.
    expect(mockClientQuery).toHaveBeenCalledTimes(7);
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
      .mockResolvedValueOnce(EMPTY)                                            // weights SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] }) // suggestion INSERT
      .mockResolvedValueOnce(EMPTY);                                          // GAP-1 control SELECT (empty)

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
      .mockResolvedValueOnce(EMPTY)                                        // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })   // vendor SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })        // findings INSERT
      .mockResolvedValueOnce(EMPTY)                                        // weights SELECT
      .mockResolvedValueOnce(EMPTY)                                        // suggestion INSERT — ON CONFLICT
      .mockResolvedValueOnce(EMPTY)                                        // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY);                                      // COMMIT

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
      .mockResolvedValueOnce(EMPTY)                                              // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings
      .mockResolvedValueOnce(EMPTY)                                              // weights
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion
      .mockResolvedValueOnce(EMPTY)                                              // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

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
      .mockResolvedValueOnce(EMPTY)                                              // BEGIN
      .mockResolvedValueOnce(EMPTY)                                              // vendor: no match
      .mockResolvedValueOnce({ rowCount: 1, rows: [aiSystemRow("medium")] })     // ai_system SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings INSERT
      .mockResolvedValueOnce(EMPTY)                                              // weights SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion INSERT
      .mockResolvedValueOnce(EMPTY)                                              // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

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
      .mockResolvedValueOnce(EMPTY)  // BEGIN
      .mockResolvedValueOnce(EMPTY)  // vendor: no match
      .mockResolvedValueOnce(EMPTY)  // ai_system: no match
      .mockResolvedValueOnce(EMPTY)  // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY); // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    expect(result.matched_branch).toBe("no_match");
    expect(result.matched_vendor_id).toBeNull();
    expect(result.matched_ai_system_id).toBeNull();
    expect(result.finding).toBeNull();
    expect(result.suggestion_id).toBeNull();
    expect(result.match_score).toBeNull();
    // Skips findings INSERT, weights SELECT, suggestion INSERT. The control
    // branch still runs (signal_type 'cve') with an empty control set.
    // 5 calls: BEGIN, vendor, ai_system, control SELECT, COMMIT.
    expect(mockClientQuery).toHaveBeenCalledTimes(5);
  });

  it("affected_vendor null short-circuits VENDOR matching (control branch still runs)", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)  // BEGIN
      .mockResolvedValueOnce(EMPTY)  // GAP-1 control SELECT (empty) — signal_type 'cve'
      .mockResolvedValueOnce(EMPTY); // COMMIT

    const result = await runMatcherForSignal(
      makeSignal({ affected_vendor: null }),
      ORG_A
    );

    expect(result.matched_branch).toBe("no_match");
    expect(result.finding).toBeNull();
    expect(result.suggestion_id).toBeNull();
    // No vendor/ai_system query ran (affected_vendor null), but the control
    // branch's controls SELECT did. BEGIN + control SELECT + COMMIT = 3.
    expect(mockClientQuery).toHaveBeenCalledTimes(3);
  });
});

// =====================================================================
// runMatcherForSignal — cross-org isolation
// =====================================================================

describe("runMatcherForSignal — cross-org isolation", () => {
  it("vendor query is parameterized by orgId — passing a different org returns no match against ORG_A's inventory", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)  // BEGIN
      .mockResolvedValueOnce(EMPTY)  // vendor: no rows for ORG_B
      .mockResolvedValueOnce(EMPTY)  // ai_system: no rows
      .mockResolvedValueOnce(EMPTY)  // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY); // COMMIT

    await runMatcherForSignal(makeSignal({ organization_id: ORG_A }), ORG_B);

    const vendorSql = mockClientQuery.mock.calls[1]![0] as string;
    const vendorParams = mockClientQuery.mock.calls[1]![1] as unknown[];
    expect(vendorSql).toMatch(/WHERE organization_id = \$1/);
    expect(vendorParams[0]).toBe(ORG_B);

    const aiSql = mockClientQuery.mock.calls[2]![0] as string;
    const aiParams = mockClientQuery.mock.calls[2]![1] as unknown[];
    expect(aiSql).toMatch(/WHERE organization_id = \$1/);
    expect(aiParams[0]).toBe(ORG_B);

    // GAP-1: the control candidates SELECT is org-scoped to the same org too.
    const controlSql = mockClientQuery.mock.calls[3]![0] as string;
    const controlParams = mockClientQuery.mock.calls[3]![1] as unknown[];
    expect(controlSql).toMatch(/FROM controls/);
    expect(controlSql).toMatch(/WHERE organization_id = \$1/);
    expect(controlParams[0]).toBe(ORG_B);
  });
});

// =====================================================================
// runMatcherForSignal — KEV override end-to-end
// =====================================================================

describe("runMatcherForSignal — KEV override", () => {
  it("source='cisa-kev' + severity='Low' produces score=100 for critical vendor", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                              // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("critical")] })     // vendor: critical
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings INSERT
      .mockResolvedValueOnce(EMPTY)                                              // weights: defaults
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion INSERT
      .mockResolvedValueOnce(EMPTY)                                              // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

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
      .mockResolvedValueOnce(EMPTY)                                              // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings
      .mockResolvedValueOnce(EMPTY)                                              // weights: NONE
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion
      .mockResolvedValueOnce(EMPTY)                                              // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

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
      .mockResolvedValueOnce(EMPTY)                                              // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings
      .mockResolvedValueOnce({ rowCount: 1, rows: [customWeights] })             // weights: configured
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion
      .mockResolvedValueOnce(EMPTY)                                              // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    // High (now 1.0) × high (0.75) × 1.0 × 100 = 75
    expect(result.match_score).toBe(75);
  });
});

// =====================================================================
// runMatcherForSignal — error propagation
// (errors fire in the vendor block, before the GAP-1 branches — unaffected)
// =====================================================================

describe("runMatcherForSignal — error propagation", () => {
  it("when standalone, ROLLBACKs on inner error and propagates", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                      // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] }) // vendor
      .mockRejectedValueOnce(new Error("simulated findings INSERT fail")) // findings INSERT throws
      .mockResolvedValueOnce(EMPTY);                                     // ROLLBACK

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
// GAP-1: control branch — signal_type cve/vulnerability/advisory
// =====================================================================

function controlRow(id: string, name: string, description: string | null = null) {
  return { id, name, description };
}

describe("runMatcherForSignal — GAP-1 control branch", () => {
  // A signal whose summary strongly overlaps "web application firewall".
  const wafSignal = (overrides: Partial<CyberSignalRecord> = {}) =>
    makeSignal({
      affected_vendor: null, // skip the vendor/AI block; isolate the control branch
      signal_type: "cve",
      normalized_summary: "Apache Struts remote code execution behind a web application firewall",
      ...overrides
    });

  it("cve signal writes a control suggestion (target_type='control') for an overlapping control", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                                  // BEGIN
      .mockResolvedValueOnce({                                                       // controls SELECT
        rowCount: 2,
        rows: [
          controlRow("c1", "Web Application Firewall"),       // high overlap → ≥40
          controlRow("c2", "Encryption at rest")              // no overlap → <40
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "sug-c1" }] })             // control INSERT (c1)
      .mockResolvedValueOnce(EMPTY);                                                // COMMIT

    const result = await runMatcherForSignal(wafSignal(), ORG_A);

    expect(result.control_suggestion_ids).toEqual(["sug-c1"]);
    expect(result.obligation_suggestion_ids).toEqual([]);
    // matched_branch is unchanged by the control branch.
    expect(result.matched_branch).toBe("no_match");

    // Exactly one control INSERT. target_type is a SQL literal ('control');
    // bound params are [orgId, signalId, target_id, score, metadata].
    const insertCall = mockClientQuery.mock.calls.find(
      (c) => /INSERT INTO signal_match_suggestions/.test(c[0] as string)
    )!;
    expect(insertCall).toBeDefined();
    const sql = insertCall[0] as string;
    expect(sql).toMatch(/'control', \$3::uuid, 'control_keyword_match'/);
    const params = insertCall[1] as unknown[];
    expect(params[2]).toBe("c1");             // target_id
    expect(typeof params[3]).toBe("number");  // integer score
    expect(params[3] as number).toBeGreaterThanOrEqual(40);
  });

  for (const t of ["vulnerability", "advisory"] as const) {
    it(`fires for signal_type='${t}' as well as 'cve'`, async () => {
      mockClientQuery
        .mockResolvedValueOnce(EMPTY)                                               // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [controlRow("c1", "Web Application Firewall")] }) // controls SELECT
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "sug-c1" }] })          // control INSERT
        .mockResolvedValueOnce(EMPTY);                                             // COMMIT

      const result = await runMatcherForSignal(wafSignal({ signal_type: t }), ORG_A);
      expect(result.control_suggestion_ids).toEqual(["sug-c1"]);
    });
  }

  it("control INSERT uses the ON CONFLICT dedup predicate; ON CONFLICT skip → id not collected", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [controlRow("c1", "Web Application Firewall")] })
      .mockResolvedValueOnce(EMPTY)                                                  // control INSERT — ON CONFLICT no-op
      .mockResolvedValueOnce(EMPTY);                                                // COMMIT

    const result = await runMatcherForSignal(wafSignal(), ORG_A);
    expect(result.control_suggestion_ids).toEqual([]); // skipped → not counted

    const insertSql = mockClientQuery.mock.calls.find(
      (c) => /INSERT INTO signal_match_suggestions/.test(c[0] as string)
    )![0] as string;
    expect(insertSql).toMatch(/ON CONFLICT \(organization_id, signal_id, target_type, target_id\)/);
    expect(insertSql).toMatch(/WHERE accepted_at IS NULL AND dismissed_at IS NULL/);
    expect(insertSql).toMatch(/DO NOTHING/);
  });

  it("NO findings INSERT and NO risk flagging on a control-only match (suggest-only)", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [controlRow("c1", "Web Application Firewall")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "sug-c1" }] })             // control INSERT
      .mockResolvedValueOnce(EMPTY);                                                // COMMIT

    const result = await runMatcherForSignal(wafSignal(), ORG_A);
    expect(result.control_suggestion_ids).toEqual(["sug-c1"]);
    expect(result.finding).toBeNull();

    const sqls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /INSERT INTO findings/.test(s))).toBe(false);
    expect(sqls.some((s) => /UPDATE risks/.test(s))).toBe(false);
  });
});

// =====================================================================
// GAP-1: obligation branch — signal_type regulatory_change
// =====================================================================

function obligationRow(id: string, source_regulation: string | null, domain: string | null) {
  return { id, source_regulation, domain };
}

describe("runMatcherForSignal — GAP-1 obligation branch", () => {
  const gdprSignal = () =>
    makeSignal({
      affected_vendor: null,
      signal_type: "regulatory_change",
      source: "ftc",
      normalized_summary: "New GDPR enforcement guidance on data protection breach notification"
    });

  it("threshold drops <40 and writes in descending score order, target_type='obligation'", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                                  // BEGIN
      .mockResolvedValueOnce({                                                       // obligations SELECT
        rowCount: 3,
        rows: [
          obligationRow("o-high", "GDPR", "data protection"),  // 3/3 tokens → 100
          obligationRow("o-mid", "GDPR", "workplace safety"),  // gdpr only of {gdpr,workplace,safety} → 33 <40? -> dropped
          obligationRow("o-zero", "OSHA", "occupational")      // 0 → dropped
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "sug-o-high" }] })         // obligation INSERT (o-high)
      .mockResolvedValueOnce(EMPTY);                                                // COMMIT

    const result = await runMatcherForSignal(gdprSignal(), ORG_A);

    // Only o-high clears 40.
    expect(result.obligation_suggestion_ids).toEqual(["sug-o-high"]);
    expect(result.control_suggestion_ids).toEqual([]);

    const insertCalls = mockClientQuery.mock.calls.filter(
      (c) => /INSERT INTO signal_match_suggestions/.test(c[0] as string)
    );
    expect(insertCalls.length).toBe(1);
    const sql = insertCalls[0]![0] as string;
    expect(sql).toMatch(/'obligation', \$3::uuid, 'obligation_domain_match'/);
    const params = insertCalls[0]![1] as unknown[];
    expect(params[2]).toBe("o-high"); // target_id (target_type is a SQL literal)
  });

  it("caps at 20 suggestions when more than 20 candidates clear the threshold", async () => {
    // 25 obligations all matching GDPR + data + protection → all score 100.
    const rows = Array.from({ length: 25 }, (_, i) =>
      obligationRow(`o${i}`, "GDPR", "data protection")
    );
    mockClientQuery.mockResolvedValueOnce(EMPTY); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rowCount: 25, rows }); // obligations SELECT
    for (let i = 0; i < 20; i++) {
      mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: `sug-${i}` }] }); // 20 INSERTs
    }
    mockClientQuery.mockResolvedValueOnce(EMPTY); // COMMIT

    const result = await runMatcherForSignal(gdprSignal(), ORG_A);

    expect(result.obligation_suggestion_ids.length).toBe(20);
    const insertCount = mockClientQuery.mock.calls.filter(
      (c) => /INSERT INTO signal_match_suggestions/.test(c[0] as string)
    ).length;
    expect(insertCount).toBe(20); // capped — not 25
  });

  it("ON CONFLICT skip on an obligation → not collected, idempotent", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [obligationRow("o1", "GDPR", "data protection")] })
      .mockResolvedValueOnce(EMPTY)                                                  // obligation INSERT — ON CONFLICT no-op
      .mockResolvedValueOnce(EMPTY);                                                // COMMIT

    const result = await runMatcherForSignal(gdprSignal(), ORG_A);
    expect(result.obligation_suggestion_ids).toEqual([]);
  });
});

// =====================================================================
// GAP-1: routing short-circuit + combined branches
// =====================================================================

describe("runMatcherForSignal — GAP-1 routing", () => {
  it("signal_type not in any branch set → neither control nor obligation SELECT runs", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)  // BEGIN
      .mockResolvedValueOnce(EMPTY); // COMMIT

    const result = await runMatcherForSignal(
      makeSignal({ affected_vendor: null, signal_type: "breach" }),
      ORG_A
    );

    expect(result.control_suggestion_ids).toEqual([]);
    expect(result.obligation_suggestion_ids).toEqual([]);
    // Only BEGIN + COMMIT — no controls/obligations SELECT.
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
    const sqls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /FROM controls/.test(s))).toBe(false);
    expect(sqls.some((s) => /FROM obligations/.test(s))).toBe(false);
  });

  it("cve + vendor match fires BOTH the vendor branch AND the control branch", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })             // vendor SELECT (match)
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })                  // findings INSERT
      .mockResolvedValueOnce(EMPTY)                                                  // weights SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })      // vendor suggestion INSERT
      .mockResolvedValueOnce({ rowCount: 1, rows: [controlRow("c1", "Web Application Firewall")] }) // controls SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "sug-c1" }] })             // control INSERT
      .mockResolvedValueOnce(EMPTY);                                                // COMMIT

    const result = await runMatcherForSignal(
      makeSignal({
        normalized_summary: "Apache Struts RCE behind a web application firewall"
      }),
      ORG_A
    );

    expect(result.matched_branch).toBe("vendor_name_ilike"); // vendor branch fired
    expect(result.suggestion_id).toBe(SUGGESTION_ID);
    expect(result.control_suggestion_ids).toEqual(["sug-c1"]); // control branch also fired
  });
});

// =====================================================================
// GAP-1: source-asserts (wiring guards)
// =====================================================================

const SUT_SRC = readFileSync(
  resolve(__dirname, "../lib/cyberSignalProcessingService.ts"),
  "utf8"
);
const MATCHING_SRC = readFileSync(
  resolve(__dirname, "../lib/signalTargetMatching.ts"),
  "utf8"
);

describe("GAP-1 wiring — source asserts", () => {
  it("obligation branch gates on signal_type 'regulatory_change'", () => {
    expect(SUT_SRC).toMatch(/signalType === "regulatory_change"/);
  });

  it("control branch gates on cve/vulnerability/advisory", () => {
    expect(SUT_SRC).toMatch(/signalType === "cve"/);
    expect(SUT_SRC).toMatch(/signalType === "vulnerability"/);
    expect(SUT_SRC).toMatch(/signalType === "advisory"/);
  });

  it("both new branches insert with target_type literals 'control' / 'obligation'", () => {
    expect(SUT_SRC).toMatch(/'control', \$3::uuid, 'control_keyword_match'/);
    expect(SUT_SRC).toMatch(/'obligation', \$3::uuid, 'obligation_domain_match'/);
  });

  it("both new INSERTs reuse the ON CONFLICT dedup predicate", () => {
    const conflictCount =
      (SUT_SRC.match(/ON CONFLICT \(organization_id, signal_id, target_type, target_id\)\s*\n\s*WHERE accepted_at IS NULL AND dismissed_at IS NULL\s*\n\s*DO NOTHING/g) || []).length;
    // vendor + control + obligation = 3 occurrences.
    expect(conflictCount).toBe(3);
  });

  it("threshold (MIN_MATCH_SCORE) is applied via filter before the top-N slice", () => {
    expect(SUT_SRC).toMatch(/\.filter\(\(c\) => c\.score >= MIN_MATCH_SCORE\)/);
    expect(SUT_SRC).toMatch(/\.sort\(\(a, b\) => b\.score - a\.score\)/);
    expect(SUT_SRC).toMatch(/\.slice\(0, SUGGESTION_CAP\)/);
  });

  it("constants are MIN_MATCH_SCORE=40, SUGGESTION_CAP=20", () => {
    expect(MATCHING_SRC).toMatch(/MIN_MATCH_SCORE\s*=\s*40/);
    expect(MATCHING_SRC).toMatch(/SUGGESTION_CAP\s*=\s*20/);
  });
});

// =====================================================================
// processSignal — orchestration over runMatcherForSignal + phases 4-5
// =====================================================================

describe("processSignal — org-scoped signal", () => {
  it("calls runMatcherForSignal AND runs phases 4-5 (linked_finding_id, risk exposure)", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                              // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings
      .mockResolvedValueOnce(EMPTY)                                              // weights
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion
      .mockResolvedValueOnce(EMPTY)                                              // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY)                                              // phase 4: signal UPDATE
      .mockResolvedValueOnce(EMPTY)                                              // phase 5: risks UPDATE
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

    // Phase 6: org profile + 4 parallel selects + posture writes (mocked).
    mockPgQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    const result = await processSignal(makeSignal({ organization_id: ORG_A }));

    expect(result.matched_vendor_id).toBe(VENDOR_ID);
    expect(result.finding).toEqual(findingRow());

    // Phase 4: cyber_signals UPDATE was issued with the finding id.
    // Index shifts +1 vs pre-GAP-1 (control SELECT inserted before phase 4).
    const phase4Sql = mockClientQuery.mock.calls[6]![0] as string;
    expect(phase4Sql).toMatch(/UPDATE cyber_signals/);
    expect(phase4Sql).toMatch(/SET processed\s+= TRUE/);
    expect(phase4Sql).toMatch(/linked_finding_id = \$1/);
    const phase4Params = mockClientQuery.mock.calls[6]![1] as unknown[];
    expect(phase4Params[0]).toBe(FINDING_ID);
  });
});

describe("processSignal — global signal short-circuit", () => {
  it("source signal with org_id IS NULL: short-circuits before phase 4 entirely", async () => {
    const result = await processSignal(
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
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })
      .mockResolvedValueOnce(EMPTY)  // GAP-1 control SELECT (empty)
      .mockResolvedValueOnce(EMPTY);

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
