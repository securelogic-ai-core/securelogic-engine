/**
 * assetRegistryView.test.ts — EAR Phase 0: real-Postgres behavior of the
 * `asset_registry_v` canonical projection (20260802_asset_registry_view.sql).
 *
 * Proves, against the full migration set:
 *   1. the view federates vendors ∪ ai_systems ∪ enterprise_entities into the
 *      canonical header with the §2.3 asset_type/status projections;
 *   2. explicit `WHERE organization_id = $1` (the route's mandatory predicate)
 *      returns ONLY that org's rows across all three backing kinds;
 *   3. defense-in-depth: as the constrained `app_request` role, RLS applies
 *      THROUGH the view (security_invoker, PG >= 15) for the RLS-bearing
 *      backing table (enterprise_entities). vendors/ai_systems carry no RLS
 *      today — the route predicate is their control — so the invoker test
 *      asserts the enterprise_entities arm only, deliberately.
 *
 * First SQL VIEW in db/migrations — there was no prior view precedent; this
 * file is also the template for future registry-view isolation tests.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

const COLS =
  "asset_id, asset_type, organization_id, name, criticality, owner_user_id, " +
  "status, backing_kind, backing_id, lifecycle_status";

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the asset_registry_v test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // Org A inventory: one of each backing kind (+ the two mapped entity types).
  await pool.query(
    `INSERT INTO vendors (organization_id, name, criticality) VALUES ($1, 'Acme Cloud', 'high')`,
    [seed.orgA.id]
  );
  await pool.query(
    `INSERT INTO ai_systems (organization_id, name, criticality, deployment_status)
     VALUES ($1, 'Fraud Model', 'critical', 'production')`,
    [seed.orgA.id]
  );
  await pool.query(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name, criticality)
     VALUES ($1, 'application', 'Billing App', 'medium'),
            ($1, 'data_store',  'Customer DB', 'critical'),
            ($1, 'business_unit', 'Finance', NULL)`,
    [seed.orgA.id]
  );

  // Org B decoys — one per backing kind; must never leak into org-A reads.
  await pool.query(
    `INSERT INTO vendors (organization_id, name) VALUES ($1, 'B Vendor')`,
    [seed.orgB.id]
  );
  await pool.query(
    `INSERT INTO ai_systems (organization_id, name) VALUES ($1, 'B Model')`,
    [seed.orgB.id]
  );
  await pool.query(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name)
     VALUES ($1, 'application', 'B App')`,
    [seed.orgB.id]
  );
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("EAR Phase 0 — asset_registry_v", () => {
  it("federates all three backing kinds under the canonical header (org-scoped)", async () => {
    const r = await pool.query(
      `SELECT ${COLS} FROM asset_registry_v WHERE organization_id = $1 ORDER BY name`,
      [seed.orgA.id]
    );
    expect(r.rowCount).toBe(5);

    const byName = new Map(r.rows.map((row) => [row.name as string, row]));
    expect(byName.get("Acme Cloud")).toMatchObject({
      asset_type: "vendor", backing_kind: "vendors", status: "active",
      criticality: "high", lifecycle_status: null
    });
    expect(byName.get("Fraud Model")).toMatchObject({
      asset_type: "ai_system", backing_kind: "ai_systems", status: "production",
      criticality: "critical"
    });
    expect(byName.get("Billing App")).toMatchObject({
      asset_type: "application", backing_kind: "enterprise_entities", status: "active"
    });
    expect(byName.get("Customer DB")).toMatchObject({
      asset_type: "database", backing_kind: "enterprise_entities", criticality: "critical"
    });
    expect(byName.get("Finance")).toMatchObject({
      asset_type: "generic", backing_kind: "enterprise_entities", criticality: null
    });

    // Phase 0: asset identity IS the backing identity until the assets table ships.
    for (const row of r.rows) expect(row.asset_id).toBe(row.backing_id);
  });

  it("org predicate excludes every cross-org row across all three arms", async () => {
    const r = await pool.query(
      `SELECT name, organization_id FROM asset_registry_v WHERE organization_id = $1`,
      [seed.orgB.id]
    );
    const names = r.rows.map((row) => row.name as string).sort();
    expect(names).toEqual(["B App", "B Model", "B Vendor"]);
    for (const row of r.rows) expect(row.organization_id).toBe(seed.orgB.id);
  });

  it("asset_type filtering matches the §2.3 projection (database ≠ data_store)", async () => {
    const dbRows = await pool.query(
      `SELECT name FROM asset_registry_v WHERE organization_id = $1 AND asset_type = 'database'`,
      [seed.orgA.id]
    );
    expect(dbRows.rows.map((r) => r.name)).toEqual(["Customer DB"]);

    const none = await pool.query(
      `SELECT 1 FROM asset_registry_v WHERE organization_id = $1 AND asset_type = 'data_store'`,
      [seed.orgA.id]
    );
    expect(none.rowCount).toBe(0);
  });

  it("security_invoker: enterprise_entities RLS applies THROUGH the view for app_request", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      // No org predicate on purpose: the enterprise_entities arm must be
      // RLS-filtered to org A even without WHERE. (vendors/ai_systems have no
      // RLS — not asserted here; the route always adds the predicate.)
      const r = await client.query(
        `SELECT name, organization_id FROM asset_registry_v WHERE backing_kind = 'enterprise_entities'`
      );
      expect(r.rowCount).toBe(3); // org A's three entities; B App filtered by RLS
      for (const row of r.rows) expect(row.organization_id).toBe(seed.orgA.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request can read the view (grants in place for the A04-G1 role flip)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const r = await client.query(
        `SELECT count(*)::int AS n FROM asset_registry_v WHERE organization_id = $1`,
        [seed.orgA.id]
      );
      expect(Number(r.rows[0].n)).toBe(5);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
