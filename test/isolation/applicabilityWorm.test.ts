/**
 * applicabilityWorm.test.ts — AD-16: the applicability decision record is WORM.
 *
 * Proves the append-only guarantee holds against the OWNER connection (the elevated
 * case AD-16 cares about — "survives even elevated access"), not merely the
 * RLS-filtered rowCount-0 path. The BEFORE UPDATE/DELETE + BEFORE TRUNCATE triggers
 * fire regardless of role, so UPDATE/DELETE/TRUNCATE must RAISE for all three tables;
 * INSERT must succeed. Complements applicabilityAssessmentsRls.test.ts (tenant scope).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let assessmentId: string;
let evidenceId: string;
let affectedId: string;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the applicability WORM test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const a = await pool.query<{ id: string }>(
    `INSERT INTO applicability_assessments
       (organization_id, signal_id, target_type, target_id, decision, confidence,
        confidence_band, reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
     VALUES ($1, $2, 'vendor', $3, 'affected', 90, 'high', '[]'::jsonb,
             'iae-v1.0.0', 'applicability-result.v1', $4, $5) RETURNING id`,
    [seed.orgA.id, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), "worm" + "0".repeat(60)]
  );
  assessmentId = a.rows[0].id;

  const e = await pool.query<{ id: string }>(
    `INSERT INTO applicability_evidence
       (assessment_id, organization_id, evidence_type, ref_table, ref_id, captured_value, weight)
     VALUES ($1, $2, 'match_candidate', 'signal_match_suggestions', $3, '{"x":1}'::jsonb, 1) RETURNING id`,
    [assessmentId, seed.orgA.id, crypto.randomUUID()]
  );
  evidenceId = e.rows[0].id;

  const f = await pool.query<{ id: string }>(
    `INSERT INTO applicability_affected_entities
       (assessment_id, organization_id, node_type, node_id, min_depth, via_target_type, via_target_id)
     VALUES ($1, $2, 'application', $3, 1, 'vendor', $4) RETURNING id`,
    [assessmentId, seed.orgA.id, crypto.randomUUID(), crypto.randomUUID()]
  );
  affectedId = f.rows[0].id;
}, 120_000);

afterAll(async () => { await pool?.end(); });

const CASES: Array<{ table: string; getId: () => string; update: (id: string) => [string, unknown[]] }> = [
  {
    table: "applicability_assessments",
    getId: () => assessmentId,
    update: (id) => ["UPDATE applicability_assessments SET confidence = 1 WHERE id = $1", [id]]
  },
  {
    table: "applicability_evidence",
    getId: () => evidenceId,
    update: (id) => ["UPDATE applicability_evidence SET weight = 99 WHERE id = $1", [id]]
  },
  {
    table: "applicability_affected_entities",
    getId: () => affectedId,
    update: (id) => ["UPDATE applicability_affected_entities SET min_depth = 9 WHERE id = $1", [id]]
  }
];

describe("AD-16 — applicability record is WORM (owner connection, elevated)", () => {
  for (const c of CASES) {
    it(`${c.table}: UPDATE raises append-only`, async () => {
      const [sql, params] = c.update(c.getId());
      await expect(pool.query(sql, params)).rejects.toThrow(/append-only|WORM/i);
    });

    it(`${c.table}: DELETE raises append-only`, async () => {
      await expect(pool.query(`DELETE FROM ${c.table} WHERE id = $1`, [c.getId()])).rejects.toThrow(/append-only|WORM/i);
    });

    it(`${c.table}: TRUNCATE raises append-only`, async () => {
      await expect(pool.query(`TRUNCATE ${c.table}`)).rejects.toThrow(/append-only|WORM/i);
    });

    it(`${c.table}: the row still exists after the blocked mutations`, async () => {
      const r = await pool.query(`SELECT id FROM ${c.table} WHERE id = $1`, [c.getId()]);
      expect(r.rowCount).toBe(1);
    });
  }
});
