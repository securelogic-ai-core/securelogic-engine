/**
 * llmVerdictCacheRls.test.ts — DB-layer tenant isolation on
 * `llm_control_matcher_verdicts` (migration 20261023).
 *
 * The verdict cache holds each org's derived control-mapping analysis, keyed by
 * a signal hash that is IDENTICAL across orgs — the same CVE produces the same
 * `signal_dedup_hash` everywhere. Two orgs can also hold the same
 * `control_inventory_digest` if their control sets happen to match. So the
 * organization_id column is the ONLY thing separating one tenant's verdicts
 * from another's, and a policy regression here would leak one customer's
 * control analysis to another under a colliding key.
 *
 * That is precisely why these tests assert isolation with a DELIBERATELY
 * COLLIDING key: same signal hash, same control digest, same prompt version,
 * different org. If isolation depended on key uniqueness rather than the RLS
 * policy, every one of these would fail.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

/** The colliding key — identical for both orgs by construction. */
const SIGNAL_HASH = "sha256:collide-me-across-tenants";
const CONTROL_DIGEST = "sha256:identical-control-inventory";
const PROMPT_VERSION = "control-matcher-v1";

const INSERT = `
  INSERT INTO llm_control_matcher_verdicts
    (organization_id, signal_dedup_hash, control_inventory_digest, prompt_version,
     state, verdict, model, input_tokens, output_tokens)
  VALUES ($1, $2, $3, $4, 'answered', $5::jsonb, 'claude-sonnet-4-6', 1000, 200)`;

const verdictFor = (org: string) =>
  JSON.stringify({ matches: [{ control_id: `control-of-${org}`, score: 90, reasoning: "r" }] });

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the verdict-cache RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  await pool.query(INSERT, [seed.orgA.id, SIGNAL_HASH, CONTROL_DIGEST, PROMPT_VERSION, verdictFor("A")]);
  await pool.query(INSERT, [seed.orgB.id, SIGNAL_HASH, CONTROL_DIGEST, PROMPT_VERSION, verdictFor("B")]);
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("llm_control_matcher_verdicts — RLS enforcement", () => {
  it("org A sees ONLY its own verdict under a key that collides with org B's", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const all = await client.query(
        `SELECT organization_id, verdict FROM llm_control_matcher_verdicts
          WHERE signal_dedup_hash = $1`,
        [SIGNAL_HASH]
      );

      expect(all.rowCount).toBe(1);
      expect(all.rows[0].organization_id).toBe(seed.orgA.id);
      // The decisive assertion: org B's analysis is not readable even though it
      // shares every other key column.
      expect(JSON.stringify(all.rows[0].verdict)).toContain("control-of-A");
      expect(JSON.stringify(all.rows[0].verdict)).not.toContain("control-of-B");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("org B cannot read org A's verdict by naming its organization_id explicitly", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);

      const crossOrg = await client.query(
        `SELECT verdict FROM llm_control_matcher_verdicts WHERE organization_id = $1`,
        [seed.orgA.id]
      );
      expect(crossOrg.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("org B cannot UPDATE org A's verdict (poisoning another tenant's cache)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);

      const upd = await client.query(
        `UPDATE llm_control_matcher_verdicts SET verdict = $1::jsonb
          WHERE organization_id = $2 AND signal_dedup_hash = $3`,
        [verdictFor("POISON"), seed.orgA.id, SIGNAL_HASH]
      );
      expect(upd.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("org A cannot INSERT a verdict stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await expect(
        client.query(INSERT, [
          seed.orgB.id,
          "sha256:another-signal",
          CONTROL_DIGEST,
          PROMPT_VERSION,
          verdictFor("A-pretending-to-be-B")
        ])
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("an UNSET org GUC sees zero rows (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const res = await client.query("SELECT 1 FROM llm_control_matcher_verdicts");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("an EMPTY-STRING org GUC sees zero rows (NULLIF fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const res = await client.query("SELECT 1 FROM llm_control_matcher_verdicts");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request cannot DELETE verdicts at all (no grant — retention/erasure run elevated)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await expect(
        client.query(`DELETE FROM llm_control_matcher_verdicts WHERE signal_dedup_hash = $1`, [
          SIGNAL_HASH
        ])
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("organization erasure removes verdicts via CASCADE (governance ruling: always org-erased)", async () => {
    // Owner channel, mirroring how tenant erasure actually runs.
    const probe = await pool.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'llm_control_matcher_verdicts'::regclass
          AND contype = 'f'
          AND confrelid = 'organizations'::regclass`
    );
    expect(probe.rowCount).toBe(1);
    expect(probe.rows[0].confdeltype).toBe("c"); // 'c' = ON DELETE CASCADE
  });
});
