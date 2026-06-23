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

const EMPTY = { rowCount: 0, rows: [] };

// Default fixture uses signal_type 'cve' with an affected_vendor → exercises the
// vendor branch. 'cve' does NOT trigger the obligation branch (regulatory_change
// only), and the control branch was removed from this package, so cve fixtures
// run exactly the vendor/AI/no-match path with no extra GAP-1 query.
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

function obligationRow(id: string, source_regulation: string | null, domain: string | null) {
  return { id, source_regulation, domain };
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
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                              // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings INSERT
      .mockResolvedValueOnce(EMPTY)                                              // weights SELECT (defaults)
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion INSERT
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    expect(result.matched_vendor_id).toBe(VENDOR_ID);
    expect(result.matched_ai_system_id).toBeNull();
    expect(result.matched_branch).toBe("vendor_name_ilike");
    expect(result.suggestion_id).toBe(SUGGESTION_ID);
    expect(result.match_score).toBe(56);
    expect(result.finding).toEqual(findingRow());
    expect(result.domain).toBe("Vendor Risk");
    // obligation branch does not fire for a 'cve' signal.
    expect(result.obligation_suggestion_ids).toEqual([]);

    const suggestionParams = mockClientQuery.mock.calls[4]![1] as unknown[];
    const parsedMetadata = JSON.parse(suggestionParams[6] as string);
    expect(parsedMetadata).toEqual({
      source: "nvd",
      matched_branch: "vendor_name_ilike",
      matched_string: "Microsoft"
    });
    expect(suggestionParams[5]).toBe(56);

    // BEGIN + 4 work queries + COMMIT = 6 client.query calls.
    expect(mockClientQuery).toHaveBeenCalledTimes(6);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("uses external client when provided — does NOT issue its own BEGIN/COMMIT/release", async () => {
    const externalClient = { query: vi.fn(), release: vi.fn() };
    externalClient.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })       // vendor SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })            // findings INSERT
      .mockResolvedValueOnce(EMPTY)                                            // weights SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] }); // suggestion INSERT

    const result = await runMatcherForSignal(
      makeSignal(),
      ORG_A,
      externalClient as unknown as Parameters<typeof runMatcherForSignal>[2]
    );

    expect(result.suggestion_id).toBe(SUGGESTION_ID);
    const calls = externalClient.query.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("BEGIN");
    expect(calls).not.toContain("COMMIT");
    expect(externalClient.release).not.toHaveBeenCalled();
    expect(mockClientRelease).not.toHaveBeenCalled();
  });

  it("idempotent: ON CONFLICT skip → suggestion_id null and match_score null", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                        // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })   // vendor SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })        // findings INSERT
      .mockResolvedValueOnce(EMPTY)                                        // weights SELECT
      .mockResolvedValueOnce(EMPTY)                                        // suggestion INSERT — ON CONFLICT
      .mockResolvedValueOnce(EMPTY);                                      // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    expect(result.matched_branch).toBe("vendor_name_ilike");
    expect(result.matched_vendor_id).toBe(VENDOR_ID);
    expect(result.suggestion_id).toBeNull();
    expect(result.match_score).toBeNull();
    expect(result.finding).toEqual(findingRow());
  });

  it("ON CONFLICT INSERT statement uses the partial-unique WHERE predicate", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })
      .mockResolvedValueOnce(EMPTY);

    await runMatcherForSignal(makeSignal(), ORG_A);

    const sql = mockClientQuery.mock.calls[4]![0] as string;
    expect(sql).toMatch(/ON CONFLICT \(organization_id, signal_id, target_type, target_id\)/);
    expect(sql).toMatch(/WHERE accepted_at IS NULL AND dismissed_at IS NULL/);
    expect(sql).toMatch(/DO NOTHING/);
  });
});

// =====================================================================
// runMatcherForSignal — ai_system match path
// =====================================================================

describe("runMatcherForSignal — ai_system match", () => {
  it("ai_system matches when no vendor matches: writes finding + suggestion target_type='ai_system'", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                              // BEGIN
      .mockResolvedValueOnce(EMPTY)                                              // vendor: no match
      .mockResolvedValueOnce({ rowCount: 1, rows: [aiSystemRow("medium")] })     // ai_system SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })              // findings INSERT
      .mockResolvedValueOnce(EMPTY)                                              // weights SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })  // suggestion INSERT
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    expect(result.matched_branch).toBe("ai_system_name_ilike");
    expect(result.matched_vendor_id).toBeNull();
    expect(result.matched_ai_system_id).toBe(AI_SYSTEM_ID);
    expect(result.suggestion_id).toBe(SUGGESTION_ID);
    expect(result.match_score).toBe(38);
    expect(result.domain).toBe("AI Governance");

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
      .mockResolvedValueOnce(EMPTY); // COMMIT

    const result = await runMatcherForSignal(makeSignal(), ORG_A);

    expect(result.matched_branch).toBe("no_match");
    expect(result.finding).toBeNull();
    expect(result.suggestion_id).toBeNull();
    expect(result.match_score).toBeNull();
    expect(result.obligation_suggestion_ids).toEqual([]);
    // BEGIN, vendor, ai_system, COMMIT = 4 ('cve' fires no obligation branch).
    expect(mockClientQuery).toHaveBeenCalledTimes(4);
  });

  it("affected_vendor null short-circuits matching entirely (cve fires no obligation branch)", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)  // BEGIN
      .mockResolvedValueOnce(EMPTY); // COMMIT

    const result = await runMatcherForSignal(
      makeSignal({ affected_vendor: null }),
      ORG_A
    );

    expect(result.matched_branch).toBe("no_match");
    expect(result.finding).toBeNull();
    expect(result.suggestion_id).toBeNull();
    // BEGIN + COMMIT only.
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
  });
});

// =====================================================================
// runMatcherForSignal — cross-org isolation
// =====================================================================

describe("runMatcherForSignal — cross-org isolation", () => {
  it("vendor + ai_system queries are parameterized by orgId", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)  // BEGIN
      .mockResolvedValueOnce(EMPTY)  // vendor: no rows for ORG_B
      .mockResolvedValueOnce(EMPTY)  // ai_system: no rows
      .mockResolvedValueOnce(EMPTY); // COMMIT

    await runMatcherForSignal(makeSignal({ organization_id: ORG_A }), ORG_B);

    const vendorSql = mockClientQuery.mock.calls[1]![0] as string;
    const vendorParams = mockClientQuery.mock.calls[1]![1] as unknown[];
    expect(vendorSql).toMatch(/WHERE organization_id = \$1/);
    expect(vendorParams[0]).toBe(ORG_B);

    const aiParams = mockClientQuery.mock.calls[2]![1] as unknown[];
    expect(aiParams[0]).toBe(ORG_B);
  });
});

// =====================================================================
// runMatcherForSignal — KEV override
// =====================================================================

describe("runMatcherForSignal — KEV override", () => {
  it("source='cisa-kev' + severity='Low' produces score=100 for critical vendor", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("critical")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })
      .mockResolvedValueOnce(EMPTY);

    const result = await runMatcherForSignal(
      makeSignal({ severity: "Low", source: "cisa-kev" }),
      ORG_A
    );

    expect(result.match_score).toBe(100);
    const params = mockClientQuery.mock.calls[4]![1] as unknown[];
    const metadata = JSON.parse(params[6] as string);
    expect(metadata.source).toBe("cisa-kev");
  });
});

// =====================================================================
// runMatcherForSignal — weights fallback
// =====================================================================

describe("runMatcherForSignal — weights fallback", () => {
  it("org with no risk_scoring_weights row uses DEFAULT_WEIGHTS", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })
      .mockResolvedValueOnce(EMPTY);

    const result = await runMatcherForSignal(makeSignal(), ORG_A);
    expect(result.match_score).toBe(56);
  });

  it("org with configured weights uses those values", async () => {
    const customWeights = {
      entity_criticality_weights: DEFAULT_WEIGHTS.entity_criticality_weights,
      obligation_priority_weights: DEFAULT_WEIGHTS.obligation_priority_weights,
      severity_weights: { Critical: 1.0, High: 1.0, Moderate: 0.5, Low: 0.25 }
    };
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [customWeights] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] })
      .mockResolvedValueOnce(EMPTY);

    const result = await runMatcherForSignal(makeSignal(), ORG_A);
    expect(result.match_score).toBe(75);
  });
});

// =====================================================================
// runMatcherForSignal — error propagation (fires in the vendor block)
// =====================================================================

describe("runMatcherForSignal — error propagation", () => {
  it("when standalone, ROLLBACKs on inner error and propagates", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })
      .mockRejectedValueOnce(new Error("simulated findings INSERT fail"))
      .mockResolvedValueOnce(EMPTY); // ROLLBACK

    await expect(runMatcherForSignal(makeSignal(), ORG_A)).rejects.toThrow(
      /simulated findings INSERT fail/
    );

    const calls = mockClientQuery.mock.calls.map((c) => c[0]);
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("when given external client, does NOT ROLLBACK — caller owns the tx", async () => {
    const externalClient = { query: vi.fn(), release: vi.fn() };
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
    expect(externalClient.release).not.toHaveBeenCalled();
  });
});

// =====================================================================
// GAP-1: obligation branch — signal_type regulatory_change, regulation identity
// =====================================================================

describe("runMatcherForSignal — GAP-1 obligation branch", () => {
  // Cites GDPR by name; affected_vendor null so the vendor block is skipped.
  const gdprSignal = (overrides: Partial<CyberSignalRecord> = {}) =>
    makeSignal({
      affected_vendor: null,
      signal_type: "regulatory_change",
      source: "ftc",
      normalized_summary: "New GDPR breach notification requirement published",
      ...overrides
    });

  it("walk (a): GDPR obligation is written; CCPA obligation sharing the domain is NOT", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                       // BEGIN
      .mockResolvedValueOnce({                                            // obligations SELECT
        rowCount: 2,
        rows: [
          obligationRow("o-gdpr", "GDPR", "data protection"), // reg cited → 80
          obligationRow("o-ccpa", "CCPA", "data protection")  // reg NOT cited → 0
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "sug-gdpr" }] }) // INSERT (GDPR only)
      .mockResolvedValueOnce(EMPTY);                                      // COMMIT

    const result = await runMatcherForSignal(gdprSignal(), ORG_A);

    expect(result.obligation_suggestion_ids).toEqual(["sug-gdpr"]);

    const insertCalls = mockClientQuery.mock.calls.filter(
      (c) => /INSERT INTO signal_match_suggestions/.test(c[0] as string)
    );
    expect(insertCalls.length).toBe(1); // CCPA NOT inserted
    const sql = insertCalls[0]![0] as string;
    expect(sql).toMatch(/'obligation', \$3::uuid, 'obligation_domain_match'/);
    const params = insertCalls[0]![1] as unknown[];
    expect(params[2]).toBe("o-gdpr"); // target_id
    expect(params[3]).toBe(80);       // base score, no domain overlap in this signal
  });

  it("walk (b): a signal citing no recognizable regulation writes nothing", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                       // BEGIN
      .mockResolvedValueOnce({                                            // obligations SELECT
        rowCount: 2,
        rows: [
          obligationRow("o-gdpr", "GDPR", "data protection"),
          obligationRow("o-ccpa", "CCPA", "data protection")
        ]
      })
      .mockResolvedValueOnce(EMPTY);                                      // COMMIT (no inserts)

    const result = await runMatcherForSignal(
      gdprSignal({ normalized_summary: "General advisory about a software patch release" }),
      ORG_A
    );

    expect(result.obligation_suggestion_ids).toEqual([]);
    const insertCount = mockClientQuery.mock.calls.filter(
      (c) => /INSERT INTO signal_match_suggestions/.test(c[0] as string)
    ).length;
    expect(insertCount).toBe(0);
  });

  it("domain is a tiebreaker, not a gate: two GDPR obligations both written, higher-domain first", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                       // BEGIN
      .mockResolvedValueOnce({                                            // obligations SELECT
        rowCount: 2,
        rows: [
          obligationRow("o-a", "GDPR", "data protection"), // 80 + 20 = 100
          obligationRow("o-b", "GDPR", "workplace safety")  // 80 + 0  = 80
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "sug-a" }] })    // INSERT o-a (100)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "sug-b" }] })    // INSERT o-b (80)
      .mockResolvedValueOnce(EMPTY);                                      // COMMIT

    const result = await runMatcherForSignal(
      gdprSignal({ normalized_summary: "New GDPR data protection breach notification rule" }),
      ORG_A
    );

    expect(result.obligation_suggestion_ids).toEqual(["sug-a", "sug-b"]);
    const insertCalls = mockClientQuery.mock.calls.filter(
      (c) => /INSERT INTO signal_match_suggestions/.test(c[0] as string)
    );
    // Sorted desc: o-a (100) inserted before o-b (80).
    expect((insertCalls[0]![1] as unknown[])[2]).toBe("o-a");
    expect((insertCalls[0]![1] as unknown[])[3]).toBe(100);
    expect((insertCalls[1]![1] as unknown[])[2]).toBe("o-b");
    expect((insertCalls[1]![1] as unknown[])[3]).toBe(80);
  });

  it("caps at 20 when more than 20 obligations cite the regulation", async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      obligationRow(`o${i}`, "GDPR", "data protection")
    );
    mockClientQuery.mockResolvedValueOnce(EMPTY); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rowCount: 25, rows }); // obligations SELECT
    for (let i = 0; i < 20; i++) {
      mockClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: `sug-${i}` }] });
    }
    mockClientQuery.mockResolvedValueOnce(EMPTY); // COMMIT

    const result = await runMatcherForSignal(gdprSignal(), ORG_A);

    expect(result.obligation_suggestion_ids.length).toBe(20);
    const insertCount = mockClientQuery.mock.calls.filter(
      (c) => /INSERT INTO signal_match_suggestions/.test(c[0] as string)
    ).length;
    expect(insertCount).toBe(20); // capped — not 25
  });

  it("ON CONFLICT skip → not collected, idempotent", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [obligationRow("o1", "GDPR", "data protection")] })
      .mockResolvedValueOnce(EMPTY) // INSERT — ON CONFLICT no-op
      .mockResolvedValueOnce(EMPTY); // COMMIT

    const result = await runMatcherForSignal(gdprSignal(), ORG_A);
    expect(result.obligation_suggestion_ids).toEqual([]);

    const sql = mockClientQuery.mock.calls.find(
      (c) => /INSERT INTO signal_match_suggestions/.test(c[0] as string)
    )![0] as string;
    expect(sql).toMatch(/ON CONFLICT \(organization_id, signal_id, target_type, target_id\)/);
    expect(sql).toMatch(/WHERE accepted_at IS NULL AND dismissed_at IS NULL/);
    expect(sql).toMatch(/DO NOTHING/);
  });

  it("NO findings INSERT and NO risk flagging on an obligation-only match (suggest-only)", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce({ rowCount: 1, rows: [obligationRow("o1", "GDPR", "data protection")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "sug-o1" }] })
      .mockResolvedValueOnce(EMPTY);

    const result = await runMatcherForSignal(gdprSignal(), ORG_A);
    expect(result.obligation_suggestion_ids).toEqual(["sug-o1"]);
    expect(result.finding).toBeNull();

    const sqls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /INSERT INTO findings/.test(s))).toBe(false);
    expect(sqls.some((s) => /UPDATE risks/.test(s))).toBe(false);
  });

  it("non-regulatory signal_type does not run the obligation branch", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)  // BEGIN
      .mockResolvedValueOnce(EMPTY); // COMMIT

    const result = await runMatcherForSignal(
      makeSignal({ affected_vendor: null, signal_type: "breach" }),
      ORG_A
    );

    expect(result.obligation_suggestion_ids).toEqual([]);
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
    const sqls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /FROM obligations/.test(s))).toBe(false);
  });

  it("regulatory signal with a vendor match fires BOTH the vendor and obligation branches", async () => {
    mockClientQuery
      .mockResolvedValueOnce(EMPTY)                                              // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [vendorRow("high")] })         // vendor SELECT (match)
      .mockResolvedValueOnce({ rowCount: 1, rows: [findingRow()] })             // findings INSERT
      .mockResolvedValueOnce(EMPTY)                                             // weights SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [suggestionInsertReturn()] }) // vendor suggestion INSERT
      .mockResolvedValueOnce({ rowCount: 1, rows: [obligationRow("o1", "GDPR", "data protection")] }) // obligations SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "sug-o1" }] })         // obligation INSERT
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

    const result = await runMatcherForSignal(
      makeSignal({
        signal_type: "regulatory_change",
        affected_vendor: "Microsoft",
        normalized_summary: "New GDPR rule affecting Microsoft data processors"
      }),
      ORG_A
    );

    expect(result.matched_branch).toBe("vendor_name_ilike"); // vendor branch fired
    expect(result.suggestion_id).toBe(SUGGESTION_ID);
    expect(result.obligation_suggestion_ids).toEqual(["sug-o1"]); // obligation branch also fired
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

  it("obligation INSERT uses target_type literal 'obligation'", () => {
    expect(SUT_SRC).toMatch(/'obligation', \$3::uuid, 'obligation_domain_match'/);
  });

  it("the control branch is fully removed from this package", () => {
    expect(SUT_SRC).not.toMatch(/scoreControlMatch/);
    expect(SUT_SRC).not.toMatch(/control_keyword_match/);
    expect(SUT_SRC).not.toMatch(/control_suggestion_ids/);
    expect(SUT_SRC).not.toMatch(/signalType === "cve"/);
    expect(MATCHING_SRC).not.toMatch(/scoreControlMatch/);
  });

  it("exactly two ON CONFLICT dedup INSERTs remain (vendor + obligation)", () => {
    const conflictCount =
      (SUT_SRC.match(/ON CONFLICT \(organization_id, signal_id, target_type, target_id\)\s*\n\s*WHERE accepted_at IS NULL AND dismissed_at IS NULL\s*\n\s*DO NOTHING/g) || []).length;
    expect(conflictCount).toBe(2);
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
      .mockResolvedValueOnce(EMPTY)                                              // phase 4: signal UPDATE
      .mockResolvedValueOnce(EMPTY)                                              // phase 5: risks UPDATE
      .mockResolvedValueOnce(EMPTY);                                            // COMMIT

    mockPgQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    const result = await processSignal(makeSignal({ organization_id: ORG_A }));

    expect(result.matched_vendor_id).toBe(VENDOR_ID);
    expect(result.finding).toEqual(findingRow());

    // 'cve' fires no obligation branch, so phase 4 is at index 5 (as before GAP-1).
    const phase4Sql = mockClientQuery.mock.calls[5]![0] as string;
    expect(phase4Sql).toMatch(/UPDATE cyber_signals/);
    expect(phase4Sql).toMatch(/SET processed\s+= TRUE/);
    expect(phase4Sql).toMatch(/linked_finding_id = \$1/);
    expect((mockClientQuery.mock.calls[5]![1] as unknown[])[0]).toBe(FINDING_ID);
  });
});

describe("processSignal — global signal short-circuit", () => {
  it("source signal with org_id IS NULL: short-circuits before phase 4 entirely", async () => {
    const result = await processSignal(
      makeSignal({ organization_id: null as unknown as string })
    );

    expect(result.finding).toBeNull();
    expect(result.matched_vendor_id).toBeNull();
    expect(result.risks_flagged).toBe(0);
    expect(result.posture_recalculated).toBe(false);
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  it("never writes linked_finding_id when source signal has org_id IS NULL", async () => {
    await processSignal(makeSignal({ organization_id: null as unknown as string }));
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
      .mockResolvedValueOnce(EMPTY);

    await runMatcherForSignal(makeSignal(), ORG_A);

    const sqls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    expect(sqls.find((s) => /INSERT INTO findings/.test(s))).toBeDefined();
    expect(sqls.find((s) => /INSERT INTO signal_match_suggestions/.test(s))).toBeDefined();
  });
});
