/**
 * applicabilityReassessmentWorker.test.ts — R3 (Slice 7): the S7 DONE bar,
 * end-to-end against real Postgres: **a changed signal re-evaluates its linked
 * entities**. Runs the REAL worker (claim on the elevated channel → plan →
 * ApplicabilityEngineV1 → 4c writer → drift → R2 dispatcher) with the ECL +
 * workflow flags enabled for this process.
 *
 * Proves:
 *   1. signal_changed → FIRST-TIME assessment born from the matcher suggestion:
 *      decision 'affected' (strong match + graph reachability), blast radius
 *      contains the enterprise entity, suggestion re-pointed at the assessment,
 *      finding + actions dispatched, job 'succeeded' — and the enqueue dedup
 *      suppresses an identical queued job.
 *   2. edge_changed after the edge is removed → REASSESSMENT: a second WORM
 *      decision (hash-chained to the first) downgrades to 'potentially_affected',
 *      drift = decision_change, and the dispatcher writes the human-review task.
 *   3. Cross-org: org B gains no rows from any of it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import { enqueueApplicabilityReassessment } from "../../src/api/lib/applicabilityReassessment.js";
import { runOneTick } from "../../src/api/workers/applicabilityReassessmentWorker.js";

let seed: TestDbSeed;
let pool: Pool;
let signalId: string;
const vendorId = crypto.randomUUID();
let entityId: string;
let edgeId: string;

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const WORKFLOW_FLAG = "SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED";
let prevEcl: string | undefined;
let prevWorkflow: string | undefined;

beforeAll(async () => {
  prevEcl = process.env[ECL_FLAG];
  prevWorkflow = process.env[WORKFLOW_FLAG];
  process.env[ECL_FLAG] = "true";
  process.env[WORKFLOW_FLAG] = "true";

  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the reassessment worker test.");
  pool = new Pool({ connectionString: url });

  signalId = await seedCyberSignal(pool, {
    orgId: seed.orgA.id,
    vendor: "ReassessCorp",
    signalType: "breach",
    severity: "High",
    dedup: `r3-worker-${crypto.randomUUID()}`
  });

  // The org's context: one enterprise entity downstream of the matched vendor.
  const ent = await pool.query<{ id: string }>(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name, criticality)
     VALUES ($1, 'application', 'Billing Portal', 'high') RETURNING id`,
    [seed.orgA.id]
  );
  entityId = ent.rows[0].id;
  const edge = await pool.query<{ id: string }>(
    `INSERT INTO enterprise_relationships (organization_id, from_type, from_id, to_type, to_id, relationship_type)
     VALUES ($1, 'vendor', $2, 'enterprise_entity', $3, 'serves') RETURNING id`,
    [seed.orgA.id, vendorId, entityId]
  );
  edgeId = edge.rows[0].id;

  // The matcher's suggestion — the candidate the engine re-reads on assessment.
  await pool.query(
    `INSERT INTO signal_match_suggestions (organization_id, signal_id, target_type, target_id, match_reason, match_score)
     VALUES ($1, $2, 'vendor', $3, 'vendor_name_ilike', 85)`,
    [seed.orgA.id, signalId, vendorId]
  );
}, 120_000);

afterAll(async () => {
  if (prevEcl === undefined) delete process.env[ECL_FLAG];
  else process.env[ECL_FLAG] = prevEcl;
  if (prevWorkflow === undefined) delete process.env[WORKFLOW_FLAG];
  else process.env[WORKFLOW_FLAG] = prevWorkflow;
  await pool?.end();
});

describe("applicability reassessment worker (real Postgres, end-to-end)", () => {
  let firstAssessmentId: string;
  let firstContentHash: string;

  it("signal_changed: births the first assessment, dispatches workflow, succeeds the job", async () => {
    const jobId = await enqueueApplicabilityReassessment(pool, seed.orgA.id, {
      type: "signal_changed",
      signal_id: signalId
    });
    expect(jobId).not.toBeNull();

    // Identical queued event → deduped.
    const dup = await enqueueApplicabilityReassessment(pool, seed.orgA.id, {
      type: "signal_changed",
      signal_id: signalId
    });
    expect(dup).toBeNull();

    const processed = await runOneTick({ workerId: "test-worker-1" });
    expect(processed).toBe(1);

    // The WORM decision record exists and concluded 'affected' via reachability.
    const assess = await pool.query(
      `SELECT id, decision, confidence_band, content_hash, prev_hash
         FROM applicability_assessments
        WHERE organization_id = $1 AND signal_id = $2 AND target_type = 'vendor' AND target_id = $3
        ORDER BY seq ASC`,
      [seed.orgA.id, signalId, vendorId]
    );
    expect(assess.rowCount).toBe(1);
    expect(assess.rows[0].decision).toBe("affected");
    firstAssessmentId = assess.rows[0].id;
    firstContentHash = assess.rows[0].content_hash;

    // Blast radius: the downstream enterprise entity, via the vendor.
    const radius = await pool.query(
      `SELECT node_type, node_id, min_depth FROM applicability_affected_entities
        WHERE organization_id = $1 AND assessment_id = $2`,
      [seed.orgA.id, firstAssessmentId]
    );
    expect(radius.rows).toEqual([
      expect.objectContaining({ node_type: "enterprise_entity", node_id: entityId, min_depth: 1 })
    ]);

    // AD-8a projection re-pointed at the decision.
    const sugg = await pool.query(
      `SELECT assessment_id FROM signal_match_suggestions
        WHERE organization_id = $1 AND signal_id = $2 AND accepted_at IS NULL AND dismissed_at IS NULL`,
      [seed.orgA.id, signalId]
    );
    expect(sugg.rows[0].assessment_id).toBe(firstAssessmentId);

    // Dispatch: finding + 2 actions (risk review + evidence request).
    const finding = await pool.query(
      `SELECT id FROM findings WHERE organization_id = $1 AND source_type = 'applicability_assessment' AND source_id = $2`,
      [seed.orgA.id, firstAssessmentId]
    );
    expect(finding.rowCount).toBe(1);
    const actions = await pool.query(
      `SELECT action_type FROM actions WHERE organization_id = $1 AND source_type = 'applicability_assessment' AND source_id = $2 ORDER BY action_type`,
      [seed.orgA.id, firstAssessmentId]
    );
    expect(actions.rows.map((r) => r.action_type)).toEqual([
      "auto_applicability_evidence_request",
      "auto_applicability_risk_review"
    ]);

    // Job terminal state: succeeded, with honest counts.
    const job = await pool.query(`SELECT status, result FROM jobs WHERE id = $1`, [jobId]);
    expect(job.rows[0].status).toBe("succeeded");
    expect(job.rows[0].result).toMatchObject({ change_type: "signal_changed", items: 1, drifted: 1, dispatched: 1 });
  });

  it("edge_changed after edge removal: reassesses, chains the WORM record, downgrades, dispatches review", async () => {
    // The org's graph changed: the vendor no longer serves the entity.
    await pool.query(`UPDATE enterprise_relationships SET deleted_at = NOW() WHERE id = $1`, [edgeId]);

    const jobId = await enqueueApplicabilityReassessment(pool, seed.orgA.id, {
      type: "edge_changed",
      organization_id: seed.orgA.id,
      node_type: "vendor",
      node_id: vendorId
    });
    expect(jobId).not.toBeNull();

    const processed = await runOneTick({ workerId: "test-worker-2" });
    expect(processed).toBe(1);

    const assess = await pool.query(
      `SELECT id, decision, content_hash, prev_hash
         FROM applicability_assessments
        WHERE organization_id = $1 AND signal_id = $2 AND target_type = 'vendor' AND target_id = $3
        ORDER BY seq ASC`,
      [seed.orgA.id, signalId, vendorId]
    );
    expect(assess.rowCount).toBe(2);
    const second = assess.rows[1];
    // Strong match with no remaining reachability → potentially_affected.
    expect(second.decision).toBe("potentially_affected");
    // Hash-chained to the first decision (AD-16).
    expect(second.prev_hash).toBe(firstContentHash);

    // No blast radius on the new decision.
    const radius = await pool.query(
      `SELECT count(*)::int AS n FROM applicability_affected_entities WHERE organization_id = $1 AND assessment_id = $2`,
      [seed.orgA.id, second.id]
    );
    expect(radius.rows[0].n).toBe(0);

    // Drift (decision_change) dispatched: the human-review task for the NEW assessment.
    const actions = await pool.query(
      `SELECT action_type FROM actions WHERE organization_id = $1 AND source_type = 'applicability_assessment' AND source_id = $2`,
      [seed.orgA.id, second.id]
    );
    expect(actions.rows.map((r) => r.action_type)).toEqual(["auto_applicability_human_review"]);
    // potentially_affected draws no finding.
    const finding = await pool.query(
      `SELECT count(*)::int AS n FROM findings WHERE organization_id = $1 AND source_type = 'applicability_assessment' AND source_id = $2`,
      [seed.orgA.id, second.id]
    );
    expect(finding.rows[0].n).toBe(0);

    // Suggestion projection now points at the NEWEST decision.
    const sugg = await pool.query(
      `SELECT assessment_id FROM signal_match_suggestions
        WHERE organization_id = $1 AND signal_id = $2 AND accepted_at IS NULL AND dismissed_at IS NULL`,
      [seed.orgA.id, signalId]
    );
    expect(sugg.rows[0].assessment_id).toBe(second.id);

    const job = await pool.query(`SELECT status, result FROM jobs WHERE id = $1`, [jobId]);
    expect(job.rows[0].status).toBe("succeeded");
    expect(job.rows[0].result).toMatchObject({ change_type: "edge_changed", items: 1, drifted: 1, dispatched: 1 });
  });

  it("cross-org: org B gained nothing from org A's pipeline", async () => {
    for (const [table, where] of [
      ["applicability_assessments", "organization_id = $1"],
      ["signal_match_suggestions", "organization_id = $1"],
      ["findings", "organization_id = $1 AND source_type = 'applicability_assessment'"],
      ["actions", "organization_id = $1 AND source_type = 'applicability_assessment'"],
      ["jobs", "organization_id = $1 AND job_type = 'applicability_reassess'"]
    ] as const) {
      const res = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, [seed.orgB.id]);
      expect(res.rows[0].n).toBe(0);
    }
  });
});
