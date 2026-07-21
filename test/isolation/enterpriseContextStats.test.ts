/**
 * enterpriseContextStats.test.ts — R6: the ECL stats endpoint against real
 * Postgres inside real tenant transactions. Seeds a small context (entities,
 * one live + one soft-deleted edge, chained applicability decisions incl. a
 * superseded one, workflow rows) and proves the rollup numbers are exact,
 * current-only, and fully org-isolated (org B reads all zeros).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";
import type { Request, Response } from "express";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import { withTenant, pg } from "../../src/api/infra/postgres.js";
import { persistApplicabilityAssessment } from "../../src/api/lib/applicabilityAssessmentWriter.js";
import { dispatchApplicabilityWorkflow } from "../../src/api/lib/applicabilityWorkflowDispatcher.js";
import { getEnterpriseContextStats } from "../../src/api/routes/enterpriseContextStats.js";
import type { ApplicabilityResult } from "../../src/engine/applicability/v1/types.js";
import type { StoredAssessment } from "../../src/engine/applicability/v1/explainability.js";

let seed: TestDbSeed;
let pool: Pool;
let signalId: string;
const targetId = crypto.randomUUID();

type CapturedRes = Response & { _status: number; _json: unknown };
function mockReqRes(orgId: string): { req: Request; res: CapturedRes } {
  const req = { organizationContext: { organizationId: orgId } } as unknown as Request;
  const res = {
    _status: 0,
    _json: undefined as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._json = body; return this; }
  };
  return { req, res: res as unknown as CapturedRes };
}

function makeResult(decision: ApplicabilityResult["decision"], entityId: string | null): ApplicabilityResult {
  return {
    decision,
    confidence: 90,
    confidence_band: "high",
    reasoning_steps: [{ rule_id: "R1", inputs_considered: "seed", outcome: decision }],
    affected_entities: entityId
      ? [{ node_type: "enterprise_entity", node_id: entityId, min_depth: 1, via_target_type: "vendor", via_target_id: targetId }]
      : [],
    engine_version: "iae-v1.0.0",
    schema_version: "applicability-result.v1"
  };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the stats test.");
  pool = new Pool({ connectionString: url });
  signalId = await seedCyberSignal(pool, {
    orgId: seed.orgA.id,
    vendor: "StatsCorp",
    dedup: `r6-stats-${crypto.randomUUID()}`
  });

  // Context inventory: 3 entities (2 high app, 1 unrated data_store) + 2 edges (1 soft-deleted).
  const ent = await pool.query<{ id: string }>(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name, criticality) VALUES
       ($1, 'application', 'App One', 'high'),
       ($1, 'application', 'App Two', 'high'),
       ($1, 'data_store',  'Lake',    NULL)
     RETURNING id`,
    [seed.orgA.id]
  );
  const appOne = ent.rows[0].id;
  await pool.query(
    `INSERT INTO enterprise_relationships (organization_id, from_type, from_id, to_type, to_id, relationship_type, deleted_at) VALUES
       ($1, 'vendor', $2, 'enterprise_entity', $3, 'serves', NULL),
       ($1, 'vendor', $2, 'enterprise_entity', $4, 'serves', NOW())`,
    [seed.orgA.id, targetId, appOne, ent.rows[1].id]
  );

  // Applicability history: superseded 'affected' → current 'affected' (with radius)
  // for one identity; a second identity currently 'needs_review'.
  await withTenant(seed.orgA.id, async () => {
    await persistApplicabilityAssessment(pg, {
      identity: { organization_id: seed.orgA.id, signal_id: signalId, target_type: "vendor", target_id: targetId },
      result: makeResult("potentially_affected", null),
      evidence: []
    });
    const current = await persistApplicabilityAssessment(pg, {
      identity: { organization_id: seed.orgA.id, signal_id: signalId, target_type: "vendor", target_id: targetId },
      result: makeResult("affected", appOne),
      evidence: []
    });
    // Dispatch the current decision → pending suggestion + open finding + 2 open actions.
    const stored: StoredAssessment = {
      organization_id: seed.orgA.id,
      signal_id: signalId,
      target_type: "vendor",
      target_id: targetId,
      ...makeResult("affected", appOne),
      evidence: [],
      content_hash: current.contentHash,
      prev_hash: current.prevHash
    };
    await dispatchApplicabilityWorkflow(pg, { assessmentId: current.assessmentId, stored });

    await persistApplicabilityAssessment(pg, {
      identity: { organization_id: seed.orgA.id, signal_id: signalId, target_type: "obligation", target_id: crypto.randomUUID() },
      result: { ...makeResult("needs_review", null), confidence: 0, confidence_band: "low" },
      evidence: []
    });
  });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("enterprise-context stats endpoint (real Postgres)", () => {
  it("returns exact, current-only rollup numbers for org A", async () => {
    const { req, res } = mockReqRes(seed.orgA.id);
    await withTenant(seed.orgA.id, () => getEnterpriseContextStats(req, res));
    expect(res._status).toBe(200);
    const s = (res._json as { stats: Record<string, never> }).stats as {
      entities: { total: number; by_type: Record<string, number>; by_criticality: Record<string, number> };
      relationships: { total: number };
      applicability: {
        current_total: number;
        by_decision: Record<string, number>;
        affected_high_confidence: number;
        total_assessments: number;
        blast_radius_nodes: number;
      };
      workflow: { pending_suggestions: number; open_findings: number; open_actions: number };
    };

    expect(s.entities.total).toBe(3);
    expect(s.entities.by_type).toEqual({ application: 2, data_store: 1 });
    expect(s.entities.by_criticality).toEqual({ high: 2 });
    // Soft-deleted edge excluded.
    expect(s.relationships.total).toBe(1);

    // Current-only: the superseded potentially_affected must NOT count.
    expect(s.applicability.current_total).toBe(2);
    expect(s.applicability.by_decision).toEqual({
      affected: 1,
      potentially_affected: 0,
      needs_review: 1,
      not_affected: 0,
      unknown: 0
    });
    expect(s.applicability.affected_high_confidence).toBe(1);
    expect(s.applicability.total_assessments).toBe(3);
    expect(s.applicability.blast_radius_nodes).toBe(1);

    // Dispatcher output: 1 pending suggestion, 1 open finding, 2 open actions.
    expect(s.workflow).toEqual({ pending_suggestions: 1, open_findings: 1, open_actions: 2 });
  });

  it("org B reads all zeros (full isolation)", async () => {
    const { req, res } = mockReqRes(seed.orgB.id);
    await withTenant(seed.orgB.id, () => getEnterpriseContextStats(req, res));
    expect(res._status).toBe(200);
    const s = (res._json as { stats: { entities: { total: number }; relationships: { total: number }; applicability: { current_total: number; total_assessments: number; blast_radius_nodes: number }; workflow: { pending_suggestions: number; open_findings: number; open_actions: number } } }).stats;
    expect(s.entities.total).toBe(0);
    expect(s.relationships.total).toBe(0);
    expect(s.applicability.current_total).toBe(0);
    expect(s.applicability.total_assessments).toBe(0);
    expect(s.applicability.blast_radius_nodes).toBe(0);
    expect(s.workflow).toEqual({ pending_suggestions: 0, open_findings: 0, open_actions: 0 });
  });
});
