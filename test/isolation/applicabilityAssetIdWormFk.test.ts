/**
 * applicabilityAssetIdWormFk.test.ts — C2 WORM/asset_id FK fix.
 *
 * Proves that after 20260831 the WORM/asset_id conflict is resolved:
 *   1. no foreign key sits on applicability_assessments.asset_id (it is a
 *      resolvable historical pointer, like node_id / ref_id / backing_id);
 *   2. deleting an asset referenced by a WORM applicability_assessment SUCCEEDS
 *      (previously the FK's ON DELETE SET NULL fired an UPDATE the WORM trigger
 *      blocked, failing the asset delete);
 *   3. the immutable assessment is UNCHANGED by the asset delete — asset_id is
 *      preserved (NOT nulled), evidence/provenance intact (WORM immutability);
 *   4. WORM still holds: a direct UPDATE of the assessment is still rejected.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { persistApplicabilityAssessment } from "../../src/api/lib/applicabilityAssessmentWriter.js";
import type { ApplicabilityResult } from "../../src/engine/applicability/v1/types.js";

let seed: TestDbSeed;
let pool: Pool;

function assetResult(): ApplicabilityResult {
  return {
    decision: "affected",
    confidence: 80,
    confidence_band: "high",
    reasoning_steps: [{ rule_id: "R1", inputs_considered: "asset", outcome: "affected" }],
    affected_entities: [
      { node_type: "application", node_id: crypto.randomUUID(), min_depth: 1, via_target_type: "asset", via_target_id: crypto.randomUUID() }
    ],
    engine_version: "iae-v1.0.0",
    schema_version: "applicability-result.v1"
  };
}

async function asOrg<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the WORM/asset_id FK test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("C2 — applicability_assessments.asset_id WORM/FK fix", () => {
  it("has no foreign key on asset_id (resolvable historical pointer, not a live FK)", async () => {
    const client = await pool.connect();
    try {
      const r = await client.query(
        `SELECT c.conname
           FROM pg_constraint c
          WHERE c.conrelid = 'applicability_assessments'::regclass
            AND c.contype = 'f'
            AND c.conkey = ARRAY[(
              SELECT a.attnum FROM pg_attribute a
               WHERE a.attrelid = 'applicability_assessments'::regclass AND a.attname = 'asset_id')]`
      );
      expect(r.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("deleting a referenced asset SUCCEEDS and leaves the immutable assessment unchanged", async () => {
    await asOrg(seed.orgA.id, async (client) => {
      // A registry asset for org A (backing is polymorphic/no-FK).
      const assetId = crypto.randomUUID();
      await client.query(
        `INSERT INTO assets (id, organization_id, asset_type, backing_kind, backing_id, lifecycle_status)
         VALUES ($1, $2, 'application', 'enterprise_entities', $3, 'active')`,
        [assetId, seed.orgA.id, crypto.randomUUID()]
      );

      // A WORM asset-target assessment pointing at it.
      const out = await persistApplicabilityAssessment(client, {
        identity: { organization_id: seed.orgA.id, signal_id: crypto.randomUUID(), target_type: "asset", target_id: crypto.randomUUID() },
        result: assetResult(),
        evidence: [{ evidence_type: "match_candidate", ref_table: "signal_match_suggestions", ref_id: null, captured_value: '{"s": 80}', weight: 1 }],
        assetId
      });

      // The delete must NOT be blocked by the WORM trigger (no FK cascade now).
      await expect(client.query(`DELETE FROM assets WHERE id = $1`, [assetId])).resolves.toBeDefined();

      // The immutable assessment is unchanged: asset_id preserved (NOT nulled).
      const after = await client.query(
        `SELECT asset_id, decision FROM applicability_assessments WHERE id = $1`,
        [out.assessmentId]
      );
      expect(after.rows[0].asset_id).toBe(assetId); // historical pointer preserved
      expect(after.rows[0].decision).toBe("affected");
    });
  });

  it("WORM still holds: even the owner cannot UPDATE the assessment (append-only trigger)", async () => {
    // Run as the OWNER (RLS is NOT FORCE, so owner bypasses tenant scoping and
    // holds UPDATE grant) — this reaches the WORM trigger itself, proving
    // immutability is enforced for every role, not just via the app_request grant.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out = await persistApplicabilityAssessment(client, {
        identity: { organization_id: seed.orgA.id, signal_id: crypto.randomUUID(), target_type: "asset", target_id: crypto.randomUUID() },
        result: assetResult(),
        evidence: [{ evidence_type: "match_candidate", ref_table: "signal_match_suggestions", ref_id: null, captured_value: '{"s": 80}', weight: 1 }],
        assetId: null
      });
      await expect(
        client.query(`UPDATE applicability_assessments SET confidence = 1 WHERE id = $1`, [out.assessmentId])
      ).rejects.toThrow(/append-only|WORM/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
