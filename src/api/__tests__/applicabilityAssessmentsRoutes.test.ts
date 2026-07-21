/**
 * applicabilityAssessmentsRoutes.test.ts — R4: handler-level unit tests for the
 * applicability read routes (pg mocked). Proves the tenant guards (403/404),
 * input validation (pagination, decision/target_type/signal_id, id), the
 * current-only list SQL shape, and that GET one assembles the stored record and
 * returns a verifying S5 explanation when the mocked rows are hash-consistent.
 * Real-Postgres read-back (incl. the jsonb-canonicalization reproducibility fix)
 * is covered by test/isolation/applicabilityReadRoutes.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));

import { pg } from "../infra/postgres.js";
import {
  listApplicabilityAssessments,
  getApplicabilityAssessment
} from "../routes/applicabilityAssessments.js";
import {
  computeContentHash,
  GENESIS_PREV_HASH,
  type EvidenceSnapshot
} from "../../engine/applicability/v1/contentHash.js";
import type { ApplicabilityResult } from "../../engine/applicability/v1/types.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "11111111-1111-4111-8111-111111111111";
const SIGNAL = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";
const q = pg.query as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0,
    _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function reqFor(query: Record<string, string> = {}, params: Record<string, string> = {}, orgId: string | null = ORG_A): Request {
  return {
    organizationContext: orgId ? { organizationId: orgId } : undefined,
    params,
    query
  } as unknown as Request;
}

beforeEach(() => q.mockReset());

describe("listApplicabilityAssessments", () => {
  it("403 without org context", async () => {
    const res = mockRes();
    await listApplicabilityAssessments(reqFor({}, {}, null), res);
    expect(res._status).toBe(403);
  });

  it("400 on invalid pagination / decision / target_type / signal_id", async () => {
    for (const query of [
      { limit: "abc" },
      { offset: "-2" },
      { decision: "definitely_affected" },
      { target_type: "spaceship" },
      { signal_id: "not-a-uuid" }
    ]) {
      const res = mockRes();
      await listApplicabilityAssessments(reqFor(query), res);
      expect(res._status).toBe(400);
    }
    expect(q).not.toHaveBeenCalled();
  });

  it("returns current-only rows with filters bound as parameters", async () => {
    q.mockResolvedValueOnce({ rows: [{ id: ID, decision: "affected", affected_count: 3 }], rowCount: 1 });
    const res = mockRes();
    await listApplicabilityAssessments(
      reqFor({ decision: "affected", target_type: "vendor", signal_id: SIGNAL, limit: "10", offset: "5" }),
      res
    );
    expect(res._status).toBe(200);
    expect(res._json).toEqual({
      applicability_assessments: [{ id: ID, decision: "affected", affected_count: 3 }],
      limit: 10,
      offset: 5
    });
    const [text, params] = q.mock.calls[0];
    expect(text).toContain("DISTINCT ON (signal_id, target_type, target_id)");
    expect(text).toContain("seq DESC");
    expect(params).toEqual([ORG_A, "affected", "vendor", SIGNAL, 10, 5]);
  });
});

describe("getApplicabilityAssessment", () => {
  it("400 on a non-uuid id; 404 when the org-scoped read returns nothing", async () => {
    const res400 = mockRes();
    await getApplicabilityAssessment(reqFor({}, { id: "nope" }), res400);
    expect(res400._status).toBe(400);

    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res404 = mockRes();
    await getApplicabilityAssessment(reqFor({}, { id: ID }), res404);
    expect(res404._status).toBe(404);
  });

  it("assembles the stored record and returns a verifying explanation", async () => {
    const result: ApplicabilityResult = {
      decision: "affected",
      confidence: 90,
      confidence_band: "high",
      reasoning_steps: [{ rule_id: "R1", inputs_considered: "x", outcome: "affected" }],
      affected_entities: [
        { node_type: "enterprise_entity", node_id: "44444444-4444-4444-8444-444444444444", min_depth: 1, via_target_type: "vendor", via_target_id: TARGET }
      ],
      engine_version: "iae-v1.0.0",
      schema_version: "applicability-result.v1"
    };
    const evidence: EvidenceSnapshot[] = [
      { evidence_type: "match_candidate", ref_table: "signal_match_suggestions", ref_id: null, captured_value: '{"s": 85}', weight: 85 }
    ];
    const identity = { organization_id: ORG_A, signal_id: SIGNAL, target_type: "vendor" as const, target_id: TARGET };
    const contentHash = computeContentHash(identity, result, evidence, GENESIS_PREV_HASH);

    q.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: ID,
        organization_id: ORG_A,
        signal_id: SIGNAL,
        target_type: "vendor",
        target_id: TARGET,
        decision: result.decision,
        confidence: result.confidence,
        confidence_band: result.confidence_band,
        reasoning_steps: result.reasoning_steps,
        engine_version: result.engine_version,
        schema_version: result.schema_version,
        content_hash: contentHash,
        prev_hash: GENESIS_PREV_HASH,
        created_at: "2026-07-05T00:00:00Z"
      }]
    });
    q.mockResolvedValueOnce({ rowCount: 1, rows: result.affected_entities });
    q.mockResolvedValueOnce({ rowCount: 1, rows: evidence });

    const res = mockRes();
    await getApplicabilityAssessment(reqFor({}, { id: ID }), res);
    expect(res._status).toBe(200);

    const body = res._json as {
      applicability_assessment: { id: string; decision: string; evidence: unknown[] };
      explanation: { headline: string; reasoning_chain: string[]; reproducibility: { reproduces: boolean } };
    };
    expect(body.applicability_assessment.id).toBe(ID);
    expect(body.applicability_assessment.decision).toBe("affected");
    expect(body.applicability_assessment.evidence).toHaveLength(1);
    expect(body.explanation.reasoning_chain.length).toBeGreaterThan(0);
    // The mocked rows are hash-consistent, so the re-derivation must verify.
    expect(body.explanation.reproducibility.reproduces).toBe(true);

    // Evidence read selects the jsonb-canonical text (what the writer hashed).
    const evidenceCall = q.mock.calls[2][0] as string;
    expect(evidenceCall).toContain("captured_value::text");
  });
});
