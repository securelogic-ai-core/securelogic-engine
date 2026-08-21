/**
 * billingDunningCyclesRls.test.ts — real-Postgres proof for the new
 * org-scoped billing table (20261028).
 *
 * `billing_dunning_cycles` is written by the Stripe webhook on the ELEVATED
 * channel, because a provider callback has no tenant scope to run as. That is a
 * deliberate bypass, and it is exactly why the table still has to carry a
 * policy: the moment anyone adds a read surface — a billing dashboard, an admin
 * view, an export — it must be org-scoped by construction rather than by
 * remembering to write a predicate.
 *
 * What is proven here: a tenant sees only its own cycles, cannot read another
 * org's row even knowing its id, and cannot forge or destroy a billing record
 * at all (SELECT is the only grant the request role holds).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let cycleA: string;
let cycleB: string;

const START_A = "2026-08-01T00:00:00Z";
const START_B = "2026-08-02T00:00:00Z";

/** Insert on the owner channel — the webhook's actual path. */
async function seedCycle(orgId: string, startedAt: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO billing_dunning_cycles (organization_id, cycle_started_at, stripe_subscription_id)
     VALUES ($1, $2, 'sub_harness') RETURNING id`,
    [orgId, startedAt],
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
  cycleA = await seedCycle(seed.orgA.id, START_A);
  cycleB = await seedCycle(seed.orgB.id, START_B);
});

afterAll(async () => {
  await pool?.end();
});

describe("billing_dunning_cycles tenant isolation", () => {
  it("a tenant sees only its own cycles", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query<{ id: string }>(`SELECT id FROM billing_dunning_cycles`)).rows,
    );

    expect(rows.map((r) => r.id)).toEqual([cycleA]);
  });

  it("naming another org's cycle id directly returns nothing", async () => {
    // The interesting case: not "did we filter", but "does the filter hold when
    // the attacker already knows the id".
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(`SELECT id FROM billing_dunning_cycles WHERE id = $1`, [cycleB])).rows,
    );

    expect(rows).toHaveLength(0);
  });

  it("a tenant with no org context set sees nothing", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const rows = (await client.query(`SELECT id FROM billing_dunning_cycles`)).rows;
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the request role cannot forge a billing record", async () => {
    await expect(
      asOrg(seed.orgA.id, async (c) =>
        c.query(
          `INSERT INTO billing_dunning_cycles (organization_id, cycle_started_at)
           VALUES ($1, '2026-09-09T00:00:00Z')`,
          [seed.orgA.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the request role cannot delete a billing record", async () => {
    await expect(
      asOrg(seed.orgA.id, async (c) =>
        c.query(`DELETE FROM billing_dunning_cycles WHERE id = $1`, [cycleA]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cycle identity is unique per (organization, cycle start)", async () => {
    // This constraint IS the notification-idempotency mechanism: it is what
    // separates the opening failure from its seven retries.
    await expect(seedCycle(seed.orgA.id, START_A)).rejects.toThrow(/duplicate key/i);
  });

  it("deleting the organization removes its cycles", async () => {
    const orgId = seed.orgB.id;
    const before = await pool.query(
      `SELECT 1 FROM billing_dunning_cycles WHERE organization_id = $1`, [orgId]);
    expect(before.rowCount).toBe(1);

    await pool.query("BEGIN");
    try {
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
      const after = await pool.query(
        `SELECT 1 FROM billing_dunning_cycles WHERE organization_id = $1`, [orgId]);
      expect(after.rowCount).toBe(0);
    } finally {
      await pool.query("ROLLBACK");
    }
  });
});
