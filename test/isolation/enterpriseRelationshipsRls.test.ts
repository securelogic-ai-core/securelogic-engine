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
