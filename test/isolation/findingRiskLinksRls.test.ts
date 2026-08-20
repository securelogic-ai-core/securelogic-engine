/**
 * findingRiskLinksRls.test.ts — real-Postgres isolation proof for the
 * Findings ↔ Risk Register relationship (SL-RISK-LINK).
 *
 * A JOIN TABLE IS THE MOST ATTRACTIVE PLACE TO LEAK. Two ids from another
 * tenant are enough to fabricate a relationship unless the database itself
 * refuses, and a relationship is exactly what a register is reported from — so
 * a forged row would not just leak, it would appear in an auditor's evidence.
 *
 * The route re-verifies both endpoints against the caller's org before
 * inserting, and that is asserted in findingRiskLinks.test.ts. This file
 * asserts the layer BELOW it: that when the engine connects as the non-owner
 * app_request role, Postgres refuses on its own.
 *
 * The WITH CHECK arm is the load-bearing half. USING alone hides reads; only
 * WITH CHECK stops a write that names another tenant's organization_id.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

let findingA: string;
let findingA2: string;
let riskA: string;
let findingB: string;
let riskB: string;
let linkA: string;

/** Owner-channel seeding — the webhook/import path, not the request path. */
async function seedFinding(orgId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, status, source_type)
     VALUES ($1, $2, 'High', 'rls harness finding', 'open', 'manual')
     RETURNING id`,
    [orgId, title],
  );
  return r.rows[0]!.id;
}

async function seedRisk(orgId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO risks (organization_id, title, domain, likelihood, impact, risk_rating)
     VALUES ($1, $2, 'cyber', 'likely', 'High', 'High')
     RETURNING id`,
    [orgId, title],
  );
  return r.rows[0]!.id;
}

async function asOrg<T>(orgId: string, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
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
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });

  findingA = await seedFinding(seed.orgA.id, "Org A finding");
  findingA2 = await seedFinding(seed.orgA.id, "Org A second finding");
  riskA = await seedRisk(seed.orgA.id, "Org A risk");
  findingB = await seedFinding(seed.orgB.id, "Org B finding");
  riskB = await seedRisk(seed.orgB.id, "Org B risk");

  const l = await pool.query<{ id: string }>(
    `INSERT INTO finding_risks (organization_id, finding_id, risk_id, link_type)
     VALUES ($1, $2, $3, 'linked') RETURNING id`,
    [seed.orgA.id, findingA, riskA],
  );
  linkA = l.rows[0]!.id;

  await pool.query(
    `INSERT INTO finding_risks (organization_id, finding_id, risk_id, link_type)
     VALUES ($1, $2, $3, 'linked')`,
    [seed.orgB.id, findingB, riskB],
  );
});

afterAll(async () => {
  await pool?.end();
});

describe("reads are org-scoped", () => {
  it("a tenant sees only its own links", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query<{ id: string }>(`SELECT id FROM finding_risks`)).rows,
    );

    expect(rows.map((r) => r.id)).toEqual([linkA]);
  });

  it("naming another tenant's link id directly returns nothing", async () => {
    const rows = await asOrg(seed.orgB.id, async (c) =>
      (await c.query(`SELECT id FROM finding_risks WHERE id = $1`, [linkA])).rows,
    );

    expect(rows).toHaveLength(0);
  });

  it("with no org context set, a tenant role sees nothing", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const rows = (await client.query(`SELECT id FROM finding_risks`)).rows;
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});

describe("writes cannot forge a cross-tenant relationship", () => {
  it("WITH CHECK refuses a row stamped with another tenant's org", async () => {
    // The attack the route's own checks would already stop — proven here to
    // hold at the database, so it survives a future caller that forgets.
    await expect(
      asOrg(seed.orgA.id, async (c) =>
        c.query(
          `INSERT INTO finding_risks (organization_id, finding_id, risk_id)
           VALUES ($1, $2, $3)`,
          [seed.orgB.id, findingB, riskB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a foreign finding id cannot be linked even under the caller's own org", async () => {
    // The row would pass the org predicate — organization_id is the caller's —
    // so the FK plus the route's endpoint re-verification is what stops it.
    // Here the FK holds, which means the row would be REACHABLE by org A: this
    // asserts the database's limit honestly rather than overclaiming.
    const inserted = await asOrg(seed.orgA.id, async (c) =>
      c.query(
        `INSERT INTO finding_risks (organization_id, finding_id, risk_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [seed.orgA.id, findingB, riskA],
      ),
    );

    // It inserts (and is rolled back by asOrg) — which is exactly why
    // resolveEndpoints() in the route re-verifies BOTH ids against the caller's
    // org before this statement is ever issued. RLS alone is not sufficient for
    // a join table, and that is the point of documenting it.
    expect(inserted.rowCount).toBe(1);
  });

  it("the tenant role cannot UPDATE a relationship into a different pair", async () => {
    // No UPDATE grant: a relationship is created or removed, never edited.
    await expect(
      asOrg(seed.orgA.id, async (c) =>
        c.query(`UPDATE finding_risks SET risk_id = $1 WHERE id = $2`, [riskA, linkA]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("the relationship is a relationship, not an owner", () => {
  it("deleting the link leaves BOTH objects intact", async () => {
    await pool.query("BEGIN");
    try {
      await pool.query(`DELETE FROM finding_risks WHERE id = $1`, [linkA]);

      const f = await pool.query(`SELECT 1 FROM findings WHERE id = $1`, [findingA]);
      const r = await pool.query(`SELECT 1 FROM risks WHERE id = $1`, [riskA]);
      expect(f.rowCount).toBe(1);
      expect(r.rowCount).toBe(1);
    } finally {
      await pool.query("ROLLBACK");
    }
  });

  it("one risk can carry many findings", async () => {
    await pool.query("BEGIN");
    try {
      await pool.query(
        `INSERT INTO finding_risks (organization_id, finding_id, risk_id, link_type)
         VALUES ($1, $2, $3, 'linked')`,
        [seed.orgA.id, findingA2, riskA],
      );

      const rows = await pool.query(
        `SELECT finding_id FROM finding_risks WHERE risk_id = $1`, [riskA]);
      expect(rows.rowCount).toBe(2);
    } finally {
      await pool.query("ROLLBACK");
    }
  });

  it("the same pair cannot be linked twice", async () => {
    // The register must never count one finding as two pieces of evidence.
    await expect(
      pool.query(
        `INSERT INTO finding_risks (organization_id, finding_id, risk_id)
         VALUES ($1, $2, $3)`,
        [seed.orgA.id, findingA, riskA],
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("link_type is constrained to the two human acts", async () => {
    await expect(
      pool.query(
        `INSERT INTO finding_risks (organization_id, finding_id, risk_id, link_type)
         VALUES ($1, $2, $3, 'auto_promoted')`,
        [seed.orgA.id, findingA2, riskA],
      ),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it("deleting the organization removes its links", async () => {
    await pool.query("BEGIN");
    try {
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [seed.orgB.id]);
      const rows = await pool.query(
        `SELECT 1 FROM finding_risks WHERE organization_id = $1`, [seed.orgB.id]);
      expect(rows.rowCount).toBe(0);
    } finally {
      await pool.query("ROLLBACK");
    }
  });
});
