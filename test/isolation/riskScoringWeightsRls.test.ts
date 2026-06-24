/**
 * riskScoringWeightsRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `risk_scoring_weights` (migration 20260703_risk_scoring_weights_rls.sql).
 *
 * First core-entity-layer table enabled after the aggregator-wrap prerequisite.
 * The route family (riskScoringWeights.ts GET + PUT) is asTenant()-wrapped; the
 * recompute reader (signalMatchSuggestions.ts) is wrapped; the matcher reader
 * (cyberSignalProcessingService) uses pgElevated (bypasses RLS). One row per org
 * (organization_id NOT NULL + UNIQUE).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

const W = JSON.stringify({ Critical: 1, High: 0.7, Moderate: 0.4, Low: 0.1 });

const INSERT_WEIGHTS = `INSERT INTO risk_scoring_weights
    (organization_id, entity_criticality_weights, obligation_priority_weights, severity_weights)
  VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb)
  RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the risk_scoring_weights RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  await pool.query(INSERT_WEIGHTS, [seed.orgA.id, W, W, W]);
  await pool.query(INSERT_WEIGHTS, [seed.orgB.id, W, W, W]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — risk_scoring_weights RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's weights, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM risk_scoring_weights WHERE organization_id = $1",
        [seed.orgB.id],
      );
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM risk_scoring_weights");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can UPDATE its own weights row (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const upd = await client.query(
        "UPDATE risk_scoring_weights SET updated_at = NOW() WHERE organization_id = $1",
        [seed.orgA.id],
      );
      expect(upd.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's weights (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);

      const upd = await client.query(
        "UPDATE risk_scoring_weights SET severity_weights = '{}'::jsonb WHERE organization_id = $1",
        [seed.orgA.id],
      );
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM risk_scoring_weights WHERE organization_id = $1", [seed.orgA.id]);
      expect(del.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero rows (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const res = await client.query("SELECT id FROM risk_scoring_weights");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero rows (NULLIF fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const res = await client.query("SELECT id FROM risk_scoring_weights");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT weights stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await expect(
        client.query(INSERT_WEIGHTS, [seed.orgB.id, W, W, W]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' weights)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM risk_scoring_weights");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
