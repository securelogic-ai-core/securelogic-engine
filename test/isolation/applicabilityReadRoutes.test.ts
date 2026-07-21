/**
 * applicabilityReadRoutes.test.ts — R4: the read routes against real Postgres,
 * running the actual handlers inside real tenant transactions (withTenant + the
 * pg proxy — the asTenant runtime shape). Proves:
 *   1. LIST returns only the CURRENT decision per (signal, target) — the
 *      superseded first record never surfaces — with its affected_count, and
 *      the decision filter applies to the CURRENT row.
 *   2. GET returns the full record + S5 explanation, and the AD-16 #4
 *      reproducibility block VERIFIES (reproduces === true) from read-back rows
 *      — the end-to-end proof of the writer's jsonb-canonicalization fix (the
 *      seeded evidence is deliberately non-canonical JSON).
 *   3. Cross-org: org B lists nothing and 404s on org A's assessment id.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";
import type { Request, Response } from "express";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import { withTenant, pg } from "../../src/api/infra/postgres.js";
import { persistApplicabilityAssessment } from "../../src/api/lib/applicabilityAssessmentWriter.js";
import {
  listApplicabilityAssessments,
  getApplicabilityAssessment
} from "../../src/api/routes/applicabilityAssessments.js";
import type { ApplicabilityResult } from "../../src/engine/applicability/v1/types.js";
import type { EvidenceSnapshot } from "../../src/engine/applicability/v1/contentHash.js";
import type { AssessmentExplanation } from "../../src/engine/applicability/v1/explainability.js";

let seed: TestDbSeed;
let pool: Pool;
let signalId: string;
const targetId = crypto.randomUUID();
let supersededId: string;
let currentId: string;

function makeResult(decision: ApplicabilityResult["decision"], confidence: number): ApplicabilityResult {
  return {
    decision,
    confidence,
    confidence_band: confidence >= 75 ? "high" : "medium",
    reasoning_steps: [{ rule_id: "R1", inputs_considered: `conf=${confidence}`, outcome: decision }],
    affected_entities:
      decision === "affected"
        ? [{ node_type: "enterprise_entity", node_id: crypto.randomUUID(), min_depth: 1, via_target_type: "vendor", via_target_id: targetId }]
        : [],
    engine_version: "iae-v1.0.0",
    schema_version: "applicability-result.v1"
  };
}

// Deliberately NON-canonical JSON (extra spaces, unsorted keys): the writer must
// canonicalize to the jsonb rendering before hashing, or read-back reproducibility
// can never verify. This is the regression test for that fix.
const evidence: EvidenceSnapshot[] = [
  {
    evidence_type: "match_candidate",
    ref_table: "signal_match_suggestions",
    ref_id: null,
    captured_value: '{ "score" : 85,   "branch" : "vendor_name_ilike" }',
    weight: 85
  }
];

type CapturedRes = Response & { _status: number; _json: unknown };
function mockReqRes(orgId: string | null, params: Record<string, string> = {}, query: Record<string, string> = {}): { req: Request; res: CapturedRes } {
  const req = {
    organizationContext: orgId ? { organizationId: orgId } : undefined,
    params,
    query
  } as unknown as Request;
  const res = {
    _status: 0,
    _json: undefined as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._json = body; return this; }
  };
  return { req, res: res as unknown as CapturedRes };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the read-routes test.");
  pool = new Pool({ connectionString: url });
  signalId = await seedCyberSignal(pool, {
    orgId: seed.orgA.id,
    vendor: "ReadbackCorp",
    dedup: `r4-readback-${crypto.randomUUID()}`
  });

  // Two decisions for the SAME identity: the second supersedes the first.
  supersededId = (
    await withTenant(seed.orgA.id, () =>
      persistApplicabilityAssessment(pg, {
        identity: { organization_id: seed.orgA.id, signal_id: signalId, target_type: "vendor", target_id: targetId },
        result: makeResult("affected", 88),
        evidence
      })
    )
  ).assessmentId;
  currentId = (
    await withTenant(seed.orgA.id, () =>
      persistApplicabilityAssessment(pg, {
        identity: { organization_id: seed.orgA.id, signal_id: signalId, target_type: "vendor", target_id: targetId },
        result: makeResult("potentially_affected", 60),
        evidence
      })
    )
  ).assessmentId;
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("applicability read routes (real Postgres, tenant tx)", () => {
  it("LIST: only the current decision per identity surfaces; superseded is hidden", async () => {
    const { req, res } = mockReqRes(seed.orgA.id);
    await withTenant(seed.orgA.id, () => listApplicabilityAssessments(req, res));
    expect(res._status).toBe(200);
    const body = res._json as { applicability_assessments: Array<{ id: string; decision: string; affected_count: number }> };
    expect(body.applicability_assessments).toHaveLength(1);
    expect(body.applicability_assessments[0].id).toBe(currentId);
    expect(body.applicability_assessments[0].decision).toBe("potentially_affected");
    expect(body.applicability_assessments[0].affected_count).toBe(0);
  });

  it("LIST: decision filter applies to the CURRENT row (superseded 'affected' does not match)", async () => {
    const { req, res } = mockReqRes(seed.orgA.id, {}, { decision: "affected" });
    await withTenant(seed.orgA.id, () => listApplicabilityAssessments(req, res));
    expect(res._status).toBe(200);
    expect((res._json as { applicability_assessments: unknown[] }).applicability_assessments).toHaveLength(0);
  });

  it("GET: full record + explanation, and reproducibility VERIFIES from read-back rows", async () => {
    for (const id of [supersededId, currentId]) {
      const { req, res } = mockReqRes(seed.orgA.id, { id });
      await withTenant(seed.orgA.id, () => getApplicabilityAssessment(req, res));
      expect(res._status).toBe(200);
      const body = res._json as { applicability_assessment: { id: string }; explanation: AssessmentExplanation };
      expect(body.applicability_assessment.id).toBe(id);
      expect(body.explanation.reasoning_chain.length).toBeGreaterThan(0);
      expect(body.explanation.evidence_used.length).toBeGreaterThan(0);
      // THE regression assertion: the hash re-derived from what Postgres
      // returned reproduces the stored content_hash, byte for byte.
      expect(body.explanation.reproducibility.reproduces).toBe(true);
    }
  });

  it("cross-org: org B lists nothing and 404s on org A's id", async () => {
    const list = mockReqRes(seed.orgB.id);
    await withTenant(seed.orgB.id, () => listApplicabilityAssessments(list.req, list.res));
    expect(list.res._status).toBe(200);
    expect((list.res._json as { applicability_assessments: unknown[] }).applicability_assessments).toHaveLength(0);

    const get = mockReqRes(seed.orgB.id, { id: currentId });
    await withTenant(seed.orgB.id, () => getApplicabilityAssessment(get.req, get.res));
    expect(get.res._status).toBe(404);
  });
});
