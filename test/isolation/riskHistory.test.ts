/**
 * riskHistory.test.ts — ERIP F2: real-Postgres proof that the daily snapshot
 * worker persists each org's dimensional risk rollup into risk_history,
 * upserts on a same-day re-run, is org-isolated, and self-gates on the flags.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { snapshotRiskHistory } from "../../src/api/lib/riskHistoryStore.js";
import { runRiskHistorySnapshot } from "../../src/api/workers/riskHistoryWorker.js";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";
const RISK_FLAG = "SECURELOGIC_RISK_INTELLIGENCE_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
const prev: Record<string, string | undefined> = {};
let prevHash = 0;

async function seedEndpoint(orgId: string, name: string): Promise<string> {
  return withTenant(orgId, async () => {
    const d = await pool.query(
      `INSERT INTO endpoints (organization_id, name, status, external_ref, hostname)
       VALUES ($1, $2, 'active', $3, $2) RETURNING id`,
      [orgId, name, `ext-${name}`]
    );
    const a = await pool.query(
      `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id, lifecycle_status)
       VALUES ($1, 'endpoint', 'endpoints', $2, 'active') RETURNING id`,
      [orgId, d.rows[0].id]
    );
    await pool.query(`UPDATE endpoints SET asset_id = $1 WHERE id = $2`, [a.rows[0].id, d.rows[0].id]);
    return a.rows[0].id as string;
  });
}

async function seedDecision(orgId: string, assetId: string, decision: string, confidence: number): Promise<void> {
  prevHash += 1;
  await pool.query(
    `INSERT INTO applicability_assessments
       (organization_id, signal_id, target_type, target_id, asset_id, decision, confidence,
        confidence_band, reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
     VALUES ($1, gen_random_uuid(), 'vendor', gen_random_uuid(), $2, $3, $4,
        'high', '[]'::jsonb, 'v1', 'v1', $5, $6)`,
    [orgId, assetId, decision, confidence, `rh-${prevHash}`, `rp-${prevHash}`]
  );
}

async function history(orgId: string): Promise<Array<{ dimension: string; snapshot_date: string; max_risk: number; asset_count: number }>> {
  const r = await pool.query(
    `SELECT dimension, snapshot_date::text, max_risk, asset_count FROM risk_history
      WHERE organization_id = $1 ORDER BY dimension`,
    [orgId]
  );
  return r.rows;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  for (const f of [ECL_FLAG, EAR_FLAG, RISK_FLAG]) {
    prev[f] = process.env[f];
    process.env[f] = "true";
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the risk history test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  for (const f of [ECL_FLAG, EAR_FLAG, RISK_FLAG]) {
    if (prev[f] === undefined) delete process.env[f];
    else process.env[f] = prev[f];
  }
  await pool?.end();
});

describe("ERIP F2 — risk history snapshot", () => {
  it("snapshots enterprise + per-type rows and upserts on a same-day re-run", async () => {
    const hot = await seedEndpoint(seed.orgA.id, "rh-hot-01");
    await seedEndpoint(seed.orgA.id, "rh-cool-02");
    await seedDecision(seed.orgA.id, hot, "affected", 100); // own-risk 90

    await withTenant(seed.orgA.id, () => snapshotRiskHistory(seed.orgA.id, "2026-07-06"));
    let rows = await history(seed.orgA.id);
    const enterprise = rows.find((r) => r.dimension === "enterprise")!;
    const endpoint = rows.find((r) => r.dimension === "endpoint")!;
    expect(enterprise).toMatchObject({ max_risk: 90, asset_count: 2 });
    expect(endpoint).toMatchObject({ max_risk: 90, asset_count: 2 });

    // Re-snapshot the same day after adding a lower-risk asset → row COUNT stable
    // (upsert), values refreshed.
    await seedEndpoint(seed.orgA.id, "rh-cool-03");
    await withTenant(seed.orgA.id, () => snapshotRiskHistory(seed.orgA.id, "2026-07-06"));
    rows = await history(seed.orgA.id);
    // still exactly 2 dimensions for this org+date (enterprise + endpoint)
    expect(rows.filter((r) => r.snapshot_date === "2026-07-06")).toHaveLength(2);
    expect(rows.find((r) => r.dimension === "enterprise")!.asset_count).toBe(3);
  });

  it("the worker snapshots every org for the day and is org-isolated", async () => {
    // Give org B its own asset so the sweep produces a distinct row set.
    await seedEndpoint(seed.orgB.id, "rh-b-01");

    const n = await runRiskHistorySnapshot({ today: () => "2026-07-07" });
    expect(n).toBeGreaterThanOrEqual(2); // at least org A and org B

    const a = await history(seed.orgA.id);
    const b = await history(seed.orgB.id);
    expect(a.some((r) => r.snapshot_date === "2026-07-07")).toBe(true);
    expect(b.some((r) => r.snapshot_date === "2026-07-07" && r.dimension === "endpoint")).toBe(true);
    // Org B's history never carries org A rows (org-scoped writes).
    const bClient = await pool.connect();
    try {
      await bClient.query("BEGIN");
      await bClient.query("SET LOCAL ROLE app_request");
      await bClient.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const rls = await bClient.query(`SELECT count(*)::int AS n FROM risk_history WHERE organization_id = $1`, [seed.orgA.id]);
      expect(rls.rows[0].n).toBe(0); // RLS blocks cross-org read
      await bClient.query("ROLLBACK");
    } finally {
      bClient.release();
    }
  });

  it("self-gates: with the risk flag off, the worker writes nothing", async () => {
    process.env[RISK_FLAG] = "false";
    try {
      const n = await runRiskHistorySnapshot({ today: () => "2026-07-08" });
      expect(n).toBe(0);
    } finally {
      process.env[RISK_FLAG] = "true";
    }
    const a = await history(seed.orgA.id);
    expect(a.some((r) => r.snapshot_date === "2026-07-08")).toBe(false);
  });
});
