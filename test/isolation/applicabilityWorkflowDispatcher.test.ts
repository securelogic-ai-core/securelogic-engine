/**
 * applicabilityWorkflowDispatcher.test.ts — R2 (Slice 6): end-to-end dispatcher
 * behaviour against real Postgres, driving the app_request role (RLS live) inside
 * tenant transactions. Proves, against the real 20260730 schema:
 *   1. A dispatched 'affected' decision writes the pending suggestion (carrying
 *      assessment_id), one generated finding, and two generated actions — all
 *      org-stamped, in one committed tenant tx.
 *   2. RE-dispatching the same assessment is a no-op (idempotent on the
 *      recommendation key): row counts unchanged, existing finding id returned.
 *   3. A NEW assessment for the same (org, signal, target) — the reassessment/drift
 *      path — re-points the pending suggestion at the new assessment id and
 *      generates NEW finding/actions (new content_hash → new keys).
 *   4. Cross-org: dispatching org A's decision inside org B's tenant scope is
 *      rejected by RLS WITH CHECK (suggestion write) — no partial cross-org state.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import { persistApplicabilityAssessment } from "../../src/api/lib/applicabilityAssessmentWriter.js";
import { dispatchApplicabilityWorkflow } from "../../src/api/lib/applicabilityWorkflowDispatcher.js";
import type { ApplicabilityResult } from "../../src/engine/applicability/v1/types.js";
import type { EvidenceSnapshot } from "../../src/engine/applicability/v1/contentHash.js";
import type { StoredAssessment } from "../../src/engine/applicability/v1/explainability.js";

let seed: TestDbSeed;
let pool: Pool;
let signalId: string;
const targetId = crypto.randomUUID();

function makeResult(confidence: number, affectedNode: string): ApplicabilityResult {
  return {
    decision: "affected",
    confidence,
    confidence_band: "high",
    reasoning_steps: [{ rule_id: "R1", inputs_considered: `c=${confidence}`, outcome: "affected" }],
    affected_entities: [
      { node_type: "application", node_id: affectedNode, min_depth: 1, via_target_type: "vendor", via_target_id: targetId }
    ],
    engine_version: "iae-v1.0.0",
    schema_version: "applicability-result.v1"
  };
}

const evidence: EvidenceSnapshot[] = [
  { evidence_type: "match_candidate", ref_table: "signal_match_suggestions", ref_id: null, captured_value: '{"s":92}', weight: 1 }
];

function toStored(orgId: string, result: ApplicabilityResult, hashes: { contentHash: string; prevHash: string }): StoredAssessment {
  return {
    organization_id: orgId,
    signal_id: signalId,
    target_type: "vendor",
    target_id: targetId,
    decision: result.decision,
    confidence: result.confidence,
    confidence_band: result.confidence_band,
    reasoning_steps: result.reasoning_steps,
    affected_entities: result.affected_entities,
    evidence,
    engine_version: result.engine_version,
    schema_version: result.schema_version,
    content_hash: hashes.contentHash,
    prev_hash: hashes.prevHash
  };
}

/** Run fn as app_request scoped to orgId, COMMITTING on success (the dispatcher
 *  path needs durable state across transactions, unlike the ROLLBACK harness). */
async function asOrgCommit<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function counts(orgId: string): Promise<{ suggestions: number; findings: number; actions: number }> {
  const s = await pool.query(
    "SELECT count(*)::int AS n FROM signal_match_suggestions WHERE organization_id = $1",
    [orgId]
  );
  const f = await pool.query(
    "SELECT count(*)::int AS n FROM findings WHERE organization_id = $1 AND source_type = 'applicability_assessment'",
    [orgId]
  );
  const a = await pool.query(
    "SELECT count(*)::int AS n FROM actions WHERE organization_id = $1 AND source_type = 'applicability_assessment'",
    [orgId]
  );
  return { suggestions: s.rows[0].n, findings: f.rows[0].n, actions: a.rows[0].n };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the dispatcher isolation test.");
  pool = new Pool({ connectionString: url });
  signalId = await seedCyberSignal(pool, {
    orgId: seed.orgA.id,
    vendor: "DispatchCorp",
    signalType: "breach",
    severity: "High",
    dedup: `r2-dispatch-${crypto.randomUUID()}`
  });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("applicability workflow dispatcher (real Postgres, app_request)", () => {
  let firstAssessmentId: string;
  let firstFindingId: string;

  it("dispatches an affected decision: suggestion + finding + actions in one tenant tx", async () => {
    const result = makeResult(92, crypto.randomUUID());
    const out = await asOrgCommit(seed.orgA.id, async (c) => {
      const persisted = await persistApplicabilityAssessment(c, {
        identity: { organization_id: seed.orgA.id, signal_id: signalId, target_type: "vendor", target_id: targetId },
        result,
        evidence
      });
      const dispatch = await dispatchApplicabilityWorkflow(c, {
        assessmentId: persisted.assessmentId,
        stored: toStored(seed.orgA.id, result, persisted)
      });
      return { persisted, dispatch };
    });

    firstAssessmentId = out.persisted.assessmentId;
    expect(out.dispatch.suggestion?.outcome).toBe("written");
    expect(out.dispatch.finding?.created).toBe(true);
    firstFindingId = out.dispatch.finding!.id;
    expect(out.dispatch.actionsCreated).toHaveLength(2);
    expect(out.dispatch.alerts).toHaveLength(1);
    expect(out.dispatch.alerts[0].findingId).toBe(firstFindingId);

    // Owner-connection verification of the committed rows.
    const sugg = await pool.query(
      "SELECT assessment_id, match_reason, accepted_at, dismissed_at FROM signal_match_suggestions WHERE organization_id = $1 AND signal_id = $2",
      [seed.orgA.id, signalId]
    );
    expect(sugg.rowCount).toBe(1);
    expect(sugg.rows[0].assessment_id).toBe(firstAssessmentId);
    expect(sugg.rows[0].match_reason).toBe("applicability_engine");

    const c = await counts(seed.orgA.id);
    expect(c.findings).toBe(1);
    expect(c.actions).toBe(2);
  });

  it("re-dispatching the same assessment is a no-op (idempotent on the recommendation key)", async () => {
    const before = await counts(seed.orgA.id);
    const result = makeResult(92, crypto.randomUUID());

    // Rebuild the stored view of the SAME assessment (same content_hash).
    const header = await pool.query(
      "SELECT content_hash, prev_hash, confidence FROM applicability_assessments WHERE id = $1",
      [firstAssessmentId]
    );
    const storedAgain = toStored(seed.orgA.id, { ...result, confidence: header.rows[0].confidence }, {
      contentHash: header.rows[0].content_hash,
      prevHash: header.rows[0].prev_hash
    });

    const dispatch = await asOrgCommit(seed.orgA.id, (c) =>
      dispatchApplicabilityWorkflow(c, { assessmentId: firstAssessmentId, stored: storedAgain })
    );

    expect(dispatch.suggestion?.outcome).toBe("refreshed");
    expect(dispatch.finding?.created).toBe(false);
    expect(dispatch.finding?.id).toBe(firstFindingId);
    expect(dispatch.actionsCreated).toHaveLength(0);
    expect(dispatch.actionsSkipped).toBe(2);

    const after = await counts(seed.orgA.id);
    expect(after).toEqual(before);
  });

  it("a NEW assessment (reassessment) re-points the pending suggestion and generates new work", async () => {
    const result = makeResult(75, crypto.randomUUID());
    const out = await asOrgCommit(seed.orgA.id, async (c) => {
      const persisted = await persistApplicabilityAssessment(c, {
        identity: { organization_id: seed.orgA.id, signal_id: signalId, target_type: "vendor", target_id: targetId },
        result,
        evidence
      });
      const dispatch = await dispatchApplicabilityWorkflow(c, {
        assessmentId: persisted.assessmentId,
        stored: toStored(seed.orgA.id, result, persisted)
      });
      return { persisted, dispatch };
    });

    expect(out.persisted.assessmentId).not.toBe(firstAssessmentId);
    // Pending suggestion row REUSED (DO UPDATE), now pointing at the new decision.
    expect(out.dispatch.suggestion?.outcome).toBe("refreshed");
    const sugg = await pool.query(
      "SELECT assessment_id FROM signal_match_suggestions WHERE organization_id = $1 AND signal_id = $2 AND accepted_at IS NULL AND dismissed_at IS NULL",
      [seed.orgA.id, signalId]
    );
    expect(sugg.rowCount).toBe(1);
    expect(sugg.rows[0].assessment_id).toBe(out.persisted.assessmentId);

    // New content_hash → new recommendation keys → NEW finding + actions.
    expect(out.dispatch.finding?.created).toBe(true);
    expect(out.dispatch.finding?.id).not.toBe(firstFindingId);
    expect(out.dispatch.actionsCreated).toHaveLength(2);
    const c = await counts(seed.orgA.id);
    expect(c.findings).toBe(2);
    expect(c.actions).toBe(4);
  });

  it("cross-org: dispatching org A's decision inside org B's scope is rejected by RLS", async () => {
    const result = makeResult(92, crypto.randomUUID());
    const storedA = toStored(seed.orgA.id, result, { contentHash: "x".repeat(64), prevHash: "y".repeat(64) });

    await expect(
      asOrgCommit(seed.orgB.id, (c) =>
        dispatchApplicabilityWorkflow(c, { assessmentId: firstAssessmentId, stored: storedA })
      )
    ).rejects.toThrow(/row-level security|violates/i);

    // Nothing leaked into org B.
    const b = await counts(seed.orgB.id);
    expect(b).toEqual({ suggestions: 0, findings: 0, actions: 0 });
  });
});
