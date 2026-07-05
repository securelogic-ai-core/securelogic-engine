/**
 * enterpriseRelationshipsRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * enterprise_relationships (migration 20260721_enterprise_relationships_rls.sql).
 *
 * Org-owned (organization_id NOT NULL). The route family is asTenant()-wrapped and
 * there is no background writer in Slice 2, so the policy preserves the
 * "policy => writers tenant-safe" invariant. Endpoints are polymorphic with no FK,
 * so random UUIDs are valid node ids at the DB layer (same-org membership of the
 * nodes is a ROUTE-layer pre-flight, not a DB constraint). Mirrors
 * signalMatchSuggestionsRls.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let edgeA: string;

const INSERT_EDGE = `INSERT INTO enterprise_relationships
    (organization_id, from_type, from_id, to_type, to_id, relationship_type)
  VALUES ($1, 'enterprise_entity', $2, 'vendor', $3, 'depends_on')
  RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the enterprise_relationships RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const a = await pool.query(INSERT_EDGE, [seed.orgA.id, crypto.randomUUID(), crypto.randomUUID()]);
  edgeA = a.rows[0].id as string;
  await pool.query(INSERT_EDGE, [seed.orgB.id, crypto.randomUUID(), crypto.randomUUID()]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — enterprise_relationships RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's edges, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query("SELECT id FROM enterprise_relationships WHERE organization_id = $1", [seed.orgB.id]);
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM enterprise_relationships");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT an edge for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const inserted = await client.query(INSERT_EDGE, [seed.orgA.id, crypto.randomUUID(), crypto.randomUUID()]);
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or (soft-)DELETE org A's edge (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);

      const upd = await client.query("UPDATE enterprise_relationships SET note = 'hijacked' WHERE id = $1", [edgeA]);
      expect(upd.rowCount).toBe(0);
      const soft = await client.query("UPDATE enterprise_relationships SET deleted_at = NOW() WHERE id = $1", [edgeA]);
      expect(soft.rowCount).toBe(0);
      const hard = await client.query("DELETE FROM enterprise_relationships WHERE id = $1", [edgeA]);
      expect(hard.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero edges (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const res = await client.query("SELECT id FROM enterprise_relationships");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero edges (NULLIF fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const res = await client.query("SELECT id FROM enterprise_relationships");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT an edge stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await expect(
        client.query(INSERT_EDGE, [seed.orgB.id, crypto.randomUUID(), crypto.randomUUID()])
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' edges)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM enterprise_relationships");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});

/**
 * EAR-AD-4 (20260801_enterprise_relationships_asset_expansion.sql): the graph
 * substrate expansion is ADDITIVE — the widened CHECKs admit 'asset' endpoints
 * and the six infrastructure relationship types, legacy ECL vocabulary still
 * inserts, unknown values are still rejected, and RLS applies to the new
 * vocabulary unchanged (same table, same policy).
 */
describe("EAR-AD-4 — enterprise_relationships asset/infrastructure vocabulary", () => {
  const INFRA_TYPES = [
    "hosted_on", "connects_to", "stores_data_in",
    "authenticates_via", "exposed_via", "managed_by"
  ];

  const insertSql = (fromType: string, toType: string) =>
    `INSERT INTO enterprise_relationships
       (organization_id, from_type, from_id, to_type, to_id, relationship_type)
     VALUES ($1, '${fromType}', $2, '${toType}', $3, $4) RETURNING id`;

  it("accepts every new infrastructure relationship_type (legacy endpoints)", async () => {
    for (const t of INFRA_TYPES) {
      const r = await pool.query(insertSql("enterprise_entity", "enterprise_entity"), [
        seed.orgA.id, crypto.randomUUID(), crypto.randomUUID(), t
      ]);
      expect(r.rowCount, `${t} should insert`).toBe(1);
    }
  });

  it("accepts 'asset' as BOTH endpoint types (schema-dark until registry Phase 1)", async () => {
    const from = await pool.query(insertSql("asset", "vendor"), [
      seed.orgA.id, crypto.randomUUID(), crypto.randomUUID(), "managed_by"
    ]);
    expect(from.rowCount).toBe(1);
    const to = await pool.query(insertSql("enterprise_entity", "asset"), [
      seed.orgA.id, crypto.randomUUID(), crypto.randomUUID(), "hosted_on"
    ]);
    expect(to.rowCount).toBe(1);
  });

  it("legacy ECL vocabulary still inserts (no behavior change)", async () => {
    const r = await pool.query(insertSql("enterprise_entity", "vendor"), [
      seed.orgA.id, crypto.randomUUID(), crypto.randomUUID(), "depends_on"
    ]);
    expect(r.rowCount).toBe(1);
  });

  it("still rejects unknown node types and relationship types (CHECKs intact)", async () => {
    await expect(
      pool.query(insertSql("cloud_resource", "vendor"), [
        seed.orgA.id, crypto.randomUUID(), crypto.randomUUID(), "hosted_on"
      ])
    ).rejects.toThrow(/from_type_chk/);
    await expect(
      pool.query(insertSql("enterprise_entity", "spaceship"), [
        seed.orgA.id, crypto.randomUUID(), crypto.randomUUID(), "hosted_on"
      ])
    ).rejects.toThrow(/to_type_chk/);
    await expect(
      pool.query(insertSql("enterprise_entity", "vendor"), [
        seed.orgA.id, crypto.randomUUID(), crypto.randomUUID(), "loves"
      ])
    ).rejects.toThrow(/type_chk/);
  });

  it("RLS WITH CHECK applies to the new vocabulary (cross-org insert rejected)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query(insertSql("asset", "asset"), [
          seed.orgB.id, crypto.randomUUID(), crypto.randomUUID(), "connects_to"
        ])
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the shipped recursive resolver traverses new-vocabulary edges unchanged", async () => {
    // The resolver SQL is vocabulary-agnostic; prove an asset-endpoint +
    // infrastructure-type chain is reachable with the mirrored node query
    // (same CTE as enterpriseGraphResolver.ts / enterpriseGraphResolverRls.test.ts).
    const n1 = crypto.randomUUID(), n2 = crypto.randomUUID(), n3 = crypto.randomUUID();
    await pool.query(insertSql("enterprise_entity", "asset"), [seed.orgA.id, n1, n2, "hosted_on"]);
    await pool.query(insertSql("asset", "vendor"), [seed.orgA.id, n2, n3, "managed_by"]);

    const res = await pool.query(
      `WITH RECURSIVE unified_edges AS (
         SELECT from_type, from_id, to_type, to_id FROM enterprise_relationships
          WHERE organization_id = $1 AND deleted_at IS NULL
       ),
       reachable AS (
         SELECT $2::text AS node_type, $3::uuid AS node_id, 0 AS depth,
                ARRAY[$2 || ':' || ($3::uuid)::text] AS visited
         UNION ALL
         SELECT e.to_type, e.to_id, r.depth + 1,
                r.visited || (e.to_type || ':' || (e.to_id)::text)
           FROM reachable r
           JOIN unified_edges e ON e.from_type = r.node_type AND e.from_id = r.node_id
          WHERE r.depth < $4
            AND NOT ((e.to_type || ':' || (e.to_id)::text) = ANY (r.visited))
       )
       SELECT node_type, node_id, MIN(depth)::int AS depth
         FROM reachable GROUP BY node_type, node_id`,
      [seed.orgA.id, "enterprise_entity", n1, 3]
    );
    const byId = new Map(res.rows.map((r) => [r.node_id, r]));
    expect(byId.get(n2)).toMatchObject({ node_type: "asset", depth: 1 });
    expect(byId.get(n3)).toMatchObject({ node_type: "vendor", depth: 2 });
  });
});
