/**
 * enterpriseEntitiesRls.test.ts — A04-G1: DB-layer RLS enforcement on the
 * Enterprise Context Layer tables `enterprise_entities` and
 * `enterprise_data_stores` (migration 20260719_enterprise_entities_rls.sql).
 *
 * Both tables are org-owned (organization_id NOT NULL — the child carries its own
 * denormalized organization_id, Tradeoff B1). The route family
 * (enterpriseEntities.ts) is asTenant()-wrapped and there is no background/elevated
 * writer in Slice 1, so the policy preserves the "policy => writers tenant-safe"
 * invariant. Mirrors signalMatchSuggestionsRls.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let entityA: string;
let entityB: string;
let dataStoreA: string;

async function seedEntity(p: Pool, orgId: string, name: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name)
     VALUES ($1, 'data_store', $2)
     RETURNING id`,
    [orgId, name]
  );
  return r.rows[0].id;
}

async function seedDataStore(p: Pool, entityId: string, orgId: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO enterprise_data_stores (enterprise_entity_id, organization_id, data_classification)
     VALUES ($1, $2, 'internal')
     RETURNING id`,
    [entityId, orgId]
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the enterprise_entities RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  entityA = await seedEntity(pool, seed.orgA.id, "rls-ee-a");
  entityB = await seedEntity(pool, seed.orgB.id, "rls-ee-b");
  dataStoreA = await seedDataStore(pool, entityA, seed.orgA.id);
  await seedDataStore(pool, entityB, seed.orgB.id);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — enterprise_entities RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's entities, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM enterprise_entities WHERE organization_id = $1",
        [seed.orgB.id]
      );
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM enterprise_entities");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT an entity for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const inserted = await client.query(
        `INSERT INTO enterprise_entities (organization_id, entity_type, name)
         VALUES ($1, 'asset', $2) RETURNING id`,
        [seed.orgA.id, `pos-${crypto.randomUUID()}`]
      );
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's entity (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);

      const upd = await client.query("UPDATE enterprise_entities SET name = 'hijacked' WHERE id = $1", [entityA]);
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM enterprise_entities WHERE id = $1", [entityA]);
      expect(del.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero entities (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const res = await client.query("SELECT id FROM enterprise_entities");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero entities (NULLIF fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const res = await client.query("SELECT id FROM enterprise_entities");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT an entity stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await expect(
        client.query(
          `INSERT INTO enterprise_entities (organization_id, entity_type, name)
           VALUES ($1, 'asset', $2)`,
          [seed.orgB.id, `wc-${crypto.randomUUID()}`]
        )
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' entities)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM enterprise_entities");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});

describe("A04-G1 — enterprise_data_stores RLS enforcement (typed child)", () => {
  it("app_request scoped to org A cannot see org B's data stores, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM enterprise_data_stores WHERE organization_id = $1",
        [seed.orgB.id]
      );
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM enterprise_data_stores");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's data store (rowCount 0)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);

      const upd = await client.query(
        "UPDATE enterprise_data_stores SET data_classification = 'restricted' WHERE id = $1",
        [dataStoreA]
      );
      expect(upd.rowCount).toBe(0);
      const del = await client.query("DELETE FROM enterprise_data_stores WHERE id = $1", [dataStoreA]);
      expect(del.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero data stores (NULLIF fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const res = await client.query("SELECT id FROM enterprise_data_stores");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a data store stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      // entityB belongs to org B; stamping the child for org B must be rejected by WITH CHECK.
      await expect(
        client.query(
          `INSERT INTO enterprise_data_stores (enterprise_entity_id, organization_id, data_classification)
           VALUES ($1, $2, 'internal')`,
          [entityB, seed.orgB.id]
        )
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
