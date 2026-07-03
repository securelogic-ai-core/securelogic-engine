/**
 * applicabilityAssessmentsRls.test.ts — A04-G1: DB-layer RLS enforcement on the
 * three applicability-decision tables (Slice 4b): applicability_assessments,
 * applicability_evidence, applicability_affected_entities.
 *
 * All three are org-owned (organization_id NOT NULL; children carry their own
 * denormalized organization_id, Tradeoff B1). Policies are inert (NOT FORCE) until
 * the app_request flip; this test drives the app_request role directly to prove the
 * policy is correct. Mirrors enterpriseEntitiesRls.test.ts.
 *
 * NOTE: these tables are WORM — app_request is granted only SELECT, INSERT (no
 * UPDATE/DELETE). Cross-org UPDATE/DELETE would fail on the missing grant, not the
 * policy, so the "cannot mutate" property is proven by the dedicated WORM test
 * (applicabilityWorm.test.ts) instead. Here we prove SELECT isolation + INSERT
 * WITH CHECK + fail-closed defaults.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

async function seedAssessment(p: Pool, orgId: string, prevHash: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO applicability_assessments
       (organization_id, signal_id, target_type, target_id, decision, confidence,
        confidence_band, reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
     VALUES ($1, $2, 'vendor', $3, 'affected', 90, 'high', '[]'::jsonb,
             'iae-v1.0.0', 'applicability-result.v1', $4, $5)
     RETURNING id`,
    [orgId, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID().replace(/-/g, "") + "0".repeat(32), prevHash]
  );
  return r.rows[0].id;
}

let assessmentA: string;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the applicability RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  assessmentA = await seedAssessment(pool, seed.orgA.id, "a".repeat(64));
  await seedAssessment(pool, seed.orgB.id, "b".repeat(64));

  // one evidence + one affected-entity child for org A
  await pool.query(
    `INSERT INTO applicability_evidence
       (assessment_id, organization_id, evidence_type, ref_table, ref_id, captured_value, weight)
     VALUES ($1, $2, 'match_candidate', 'signal_match_suggestions', $3, '{"match_score":90}'::jsonb, 1)`,
    [assessmentA, seed.orgA.id, crypto.randomUUID()]
  );
  await pool.query(
    `INSERT INTO applicability_affected_entities
       (assessment_id, organization_id, node_type, node_id, min_depth, via_target_type, via_target_id)
     VALUES ($1, $2, 'application', $3, 1, 'vendor', $4)`,
    [assessmentA, seed.orgA.id, crypto.randomUUID(), crypto.randomUUID()]
  );
}, 120_000);

afterAll(async () => { await pool?.end(); });

const TABLES = [
  "applicability_assessments",
  "applicability_evidence",
  "applicability_affected_entities"
] as const;

describe("A04-G1 — applicability tables RLS enforcement", () => {
  for (const table of TABLES) {
    it(`${table}: app_request scoped to org A cannot see org B's rows, sees its own`, async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE app_request");
        await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

        const crossOrg = await client.query(`SELECT id FROM ${table} WHERE organization_id = $1`, [seed.orgB.id]);
        expect(crossOrg.rowCount).toBe(0);

        const visible = await client.query(`SELECT organization_id FROM ${table}`);
        const orgs = visible.rows.map((r) => r.organization_id);
        expect(orgs).toContain(seed.orgA.id);
        expect(orgs).not.toContain(seed.orgB.id);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    });

    it(`${table}: app_request with UNSET org GUC sees zero rows (fail-closed)`, async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE app_request");
        const res = await client.query(`SELECT id FROM ${table}`);
        expect(res.rowCount).toBe(0);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    });

    it(`${table}: app_request with EMPTY-STRING org GUC sees zero rows (NULLIF fail-closed)`, async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE app_request");
        await client.query("SELECT set_config('app.current_org_id', '', true)");
        const res = await client.query(`SELECT id FROM ${table}`);
        expect(res.rowCount).toBe(0);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    });
  }

  it("app_request scoped to org A cannot INSERT an assessment stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await expect(
        client.query(
          `INSERT INTO applicability_assessments
             (organization_id, signal_id, target_type, target_id, decision, confidence,
              confidence_band, reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
           VALUES ($1, $2, 'vendor', $3, 'affected', 90, 'high', '[]'::jsonb,
                   'iae-v1.0.0', 'applicability-result.v1', $4, $5)`,
          [seed.orgB.id, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
        )
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A CAN INSERT an assessment for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const inserted = await client.query(
        `INSERT INTO applicability_assessments
           (organization_id, signal_id, target_type, target_id, decision, confidence,
            confidence_band, reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
         VALUES ($1, $2, 'vendor', $3, 'affected', 90, 'high', '[]'::jsonb,
                 'iae-v1.0.0', 'applicability-result.v1', $4, $5) RETURNING id`,
        [seed.orgA.id, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
      );
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' assessments)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM applicability_assessments");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
